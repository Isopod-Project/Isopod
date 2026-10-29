import { test, expect } from "./fixtures"

const config = { image: "itzg/minecraft-server", environment: { TYPE: "FABRIC", VERSION: "1.21.1", MODRINTH_PROJECTS: "sodium" } }

const hit = (id: string, name: string, extra = {}) => ({
  id, name, summary: `${name} summary`, icon_url: null, author: "someone", downloads: 1000, url: "", categories: [], provider: "curseforge", ...extra,
})

test.describe("CurseForge mod search", () => {
  let searches: string[]
  let savedEnv: Record<string, string> | null

  test.beforeEach(async ({ page }) => {
    searches = []
    savedEnv = null
    await page.route("**/api/instances/*/config", (route) => {
      if (route.request().method() === "PUT") {
        savedEnv = route.request().postDataJSON().environment
        return route.fulfill({ json: { message: "Config updated", downloaded: [], failed: [] } })
      }
      return route.fulfill({ json: config })
    })
    await page.route("**/api/mods/search/**", (route) => {
      const url = new URL(route.request().url())
      searches.push(url.pathname)
      if (url.pathname.endsWith("/curseforge"))
        return route.fulfill({ json: [hit("238222", "Just Enough Items"), hit("999", "Blocked Mod", { downloadable: false })] })
      return route.fulfill({ json: [{ ...hit("sodium", "Sodium"), provider: "modrinth" }] })
    })
    await page.route("**/api/mods/dependencies?**", (route) => route.fulfill({ json: ["348521"] }))

    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Mods", exact: true }).click()
    await page.getByRole("button", { name: "Download Mods" }).click()
  })

  test("switching to CurseForge searches it and lists its mods", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sodium" })).toBeVisible()
    await page.getByRole("button", { name: "CurseForge" }).click()
    await expect(page.getByRole("heading", { name: "Just Enough Items" })).toBeVisible()
    expect(searches).toContain("/api/mods/search/curseforge")
    await expect(page.getByRole("button", { name: "CurseForge" })).toHaveAttribute("aria-pressed", "true")
    // A mod only the CurseForge app can download offers no install buttons
    await expect(page.getByText("CurseForge app only")).toBeVisible()
  })

  test("installing with dependencies adds every project to CURSEFORGE_FILES", async ({ page }) => {
    await page.getByRole("button", { name: "CurseForge" }).click()
    await page.getByRole("button", { name: "Add with Deps" }).first().click()
    await expect.poll(() => savedEnv?.CURSEFORGE_FILES).toBe("238222,348521")
    // Modrinth mods are left alone
    expect(savedEnv?.MODRINTH_PROJECTS).toBe("sodium")
  })
})
