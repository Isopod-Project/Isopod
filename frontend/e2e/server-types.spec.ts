import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

const PURPUR_BUILDS = [
  { id: "2416", stable: true },
  { id: "2415", stable: true },
]

test.describe("Purpur and Folia in Add Instance", () => {
  let created: Record<string, unknown>[]

  test.beforeEach(async ({ page }) => {
    created = []
    await page.route("**/api/instances", (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      created.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: "new-server", name: "New Server" } })
    })
    await page.route(/\/api\/meta\/loaders\/purpur/i, (route) => route.fulfill({ json: PURPUR_BUILDS }))
    await page.route(/\/api\/meta\/loaders\/folia/i, (route) => route.fulfill({ json: [] }))
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await expect(page.getByText("Server Type")).toBeVisible()
  })

  test("creates a Purpur server pinned to the chosen build", async ({ page }) => {
    await page.getByRole("button", { name: "PURPUR", exact: true }).click()
    await page.getByText("2415", { exact: true }).click()
    await page.getByPlaceholder("e.g. My Modded World").fill("New Server")
    await page.getByRole("button", { name: /Next/ }).click()
    await page.getByRole("button", { name: "Create Instance" }).click()

    await expect.poll(() => created.length).toBe(1)
    expect(created[0]).toMatchObject({ template: "purpur", loader_version: "2415" })
  })

  test("Folia warns about plugins and says when the version has no builds", async ({ page }) => {
    await expect(page.getByRole("note")).toHaveCount(0)
    await page.getByRole("button", { name: "FOLIA", exact: true }).click()
    const note = page.getByRole("note")
    await expect(note).toContainText("Most Paper plugins don't work on it")
    await expect(note).toContainText("Folia has no builds for Minecraft")
  })
})

test.describe("Plugin server types in the Edit window", () => {
  let puts: { environment: Record<string, string> }[]

  async function openEdit(page: Page, type: string, tab: string) {
    puts = []
    await page.route("**/api/instances/*/config", (route) => {
      if (route.request().method() === "PUT") {
        puts.push(route.request().postDataJSON())
        return route.fulfill({ json: { message: "Config updated" } })
      }
      return route.fulfill({ json: { image: "itzg/minecraft-server", environment: { VERSION: "1.21.4", TYPE: type } } })
    })
    await page.route(/\/api\/meta\/loaders\/purpur/i, (route) => route.fulfill({ json: PURPUR_BUILDS }))
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: tab, exact: true }).click()
  }

  test("switching to Purpur saves the build in PURPUR_BUILD", async ({ page }) => {
    await openEdit(page, "PAPER", "Loaders")
    await page.getByText("Purpur", { exact: true }).click()
    await page.getByText("2416", { exact: true }).click()
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()

    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].environment).toMatchObject({ TYPE: "PURPUR", PURPUR_BUILD: "2416" })
    expect(puts[0].environment).not.toHaveProperty("LOADER_VERSION")
  })

  test("the Mods tab of a plugin server talks about plugins", async ({ page }) => {
    await openEdit(page, "PURPUR", "Mods")
    await expect(page.getByText(/^Plugins \(\d+ installed\)/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Download Plugins" })).toBeVisible()
  })
})
