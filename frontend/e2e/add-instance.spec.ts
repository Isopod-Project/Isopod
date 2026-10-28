import { test, expect } from "./fixtures"

test.describe("Add Instance modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await expect(page.getByText("Server Type")).toBeVisible()
  })

  test("opens on the Custom tab without runtime errors", async ({ page, errors }) => {
    await expect(page.getByRole("button", { name: "Custom", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Modrinth", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "CurseForge", exact: true })).toBeVisible()
    expect(errors.problems).toEqual([])
  })

  test("Import tab shows the archive import view", async ({ page }) => {
    await page.getByRole("button", { name: "Import", exact: true }).click()
    await expect(page.locator('input[type="file"]').first()).toBeAttached()
  })

  test("Modrinth tab loads the modpack search", async ({ page, errors }) => {
    await page.getByRole("button", { name: "Modrinth", exact: true }).click()
    await expect(page.getByRole("button", { name: "Modrinth", exact: true })).toBeVisible()
    expect(errors.problems).toEqual([])
  })
})

test.describe("Add Instance CurseForge", () => {
  test("CurseForge tab loads the modpack search", async ({ page, errors }) => {
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await page.getByRole("button", { name: "CurseForge", exact: true }).click()
    await expect(page.getByPlaceholder("Search curseforge modpacks...")).toBeVisible()
    expect(errors.problems).toEqual([])
  })
})

test.describe("Add Instance group", () => {
  let created: Record<string, unknown>[]
  let imported: string[]

  test.beforeEach(async ({ page }) => {
    created = []
    imported = []
    await page.route("**/api/groups", (route) => route.fulfill({ json: ["No group", "Survival"] }))
    await page.route("**/api/instances", (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      created.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: "new-server", name: "New Server" } })
    })
    await page.route("**/api/instances/import", (route) => {
      imported.push(route.request().postData() || "")
      return route.fulfill({ json: { id: "new-server", message: "Instance imported successfully" } })
    })
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /Add Instance/ }).click()
  })

  const group = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: "Group" })

  const createCustom = async (page: import("@playwright/test").Page) => {
    await page.getByPlaceholder("e.g. My Modded World").fill("New Server")
    await page.getByRole("button", { name: /Next/ }).click()
    await page.getByRole("button", { name: "Create Instance" }).click()
  }

  test("lists existing groups and creates the instance in the chosen one", async ({ page }) => {
    await expect(group(page).locator("option")).toHaveText(["No group", "Survival", "+ New Group..."])
    await group(page).selectOption("Survival")
    await createCustom(page)
    await expect.poll(() => created.map((c) => c.group)).toEqual(["Survival"])
  })

  test("+ New Group... prompts for a name and selects it", async ({ page }) => {
    await group(page).selectOption("+ New Group...")
    await page.getByRole("textbox").last().fill("Creative")
    await page.getByRole("button", { name: "OK" }).click()
    await expect(group(page)).toHaveValue("Creative")
    await createCustom(page)
    await expect.poll(() => created.map((c) => c.group)).toEqual(["Creative"])
  })

  test("imports go to the chosen group", async ({ page }) => {
    await page.getByRole("button", { name: "Import", exact: true }).click()
    await page.locator('input[type="file"]').first().setInputFiles({ name: "world.zip", mimeType: "application/zip", buffer: Buffer.from("PK") })
    await group(page).selectOption("Survival")
    await page.getByRole("button", { name: /Next/ }).click()
    await page.getByRole("button", { name: "Create Instance" }).click()
    await expect.poll(() => imported.length).toBe(1)
    expect(imported[0]).toMatch(/name="group"\r\n\r\nSurvival\r\n/)
  })

  test("the group resets when the window is reopened", async ({ page }) => {
    await group(page).selectOption("Survival")
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await expect(group(page)).toHaveValue("No group")
  })
})
