import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

// Windows close with Escape or a click on the dimmed backdrop around them.

async function openDashboard(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
}

async function openEdit(page: Page) {
  await page.getByRole("main").getByText("Alpha Server").click()
  await page.locator("aside").getByRole("button", { name: "Edit" }).click()
  await expect(editHeading(page)).toBeVisible()
}

const editHeading = (page: Page) => page.getByRole("heading", { name: "Editing: Alpha Server" })
const settingsHeading = (page: Page) => page.getByRole("heading", { name: "Application Settings" })

// Clicks the top-left corner of the screen, which is backdrop for every centred window
const clickBackdrop = (page: Page) => page.mouse.click(4, 60)

test.describe("Application Settings dismissal", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page)
    await page.getByRole("button", { name: /^Settings$/ }).click()
    await expect(settingsHeading(page)).toBeVisible()
  })

  test("Escape closes it", async ({ page }) => {
    await page.keyboard.press("Escape")
    await expect(settingsHeading(page)).toBeHidden()
  })

  test("a backdrop click closes it, a click inside does not", async ({ page }) => {
    await settingsHeading(page).click()
    await expect(settingsHeading(page)).toBeVisible()
    await clickBackdrop(page)
    await expect(settingsHeading(page)).toBeHidden()
  })

  for (const [how, close] of [
    ["Escape", (page: Page) => page.keyboard.press("Escape")],
    ["the close button", (page: Page) => page.getByTitle("Close", { exact: true }).click()],
    ["a backdrop click", clickBackdrop],
  ] as const) {
    test(`closing with ${how} puts back an unsaved theme`, async ({ page }) => {
      await page.getByRole("button", { name: "Appearance", exact: true }).click()
      await page.getByRole("button", { name: /Light Mode/ }).click()
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
      await close(page)
      await expect(settingsHeading(page)).toBeHidden()
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    })
  }
})

test.describe("Add Instance dismissal", () => {
  test("Escape closes it", async ({ page }) => {
    await openDashboard(page)
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await page.getByPlaceholder("e.g. My Modded World").fill("Half typed")
    await page.keyboard.press("Escape")
    await expect(page.getByText("Server Type")).toBeHidden()
  })
})

test.describe("Export dismissal", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page)
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.locator("aside").getByRole("button", { name: "Export" }).click()
    await expect(page.getByText("Export Instance")).toBeVisible()
  })

  test("Escape closes it", async ({ page }) => {
    await page.keyboard.press("Escape")
    await expect(page.getByText("Export Instance")).toBeHidden()
  })

  test("a backdrop click closes it", async ({ page }) => {
    await clickBackdrop(page)
    await expect(page.getByText("Export Instance")).toBeHidden()
  })
})

test.describe("Context menu and dialog dismissal", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page)
  })

  test("Escape closes the instance context menu", async ({ page }) => {
    await page.getByRole("main").getByText("Alpha Server").click({ button: "right" })
    const rename = page.getByRole("button", { name: "Rename" })
    await expect(rename).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(rename).toBeHidden()
  })

  for (const [how, dismiss] of [
    ["Escape", (page: Page) => page.keyboard.press("Escape")],
    ["a backdrop click", clickBackdrop],
  ] as const) {
    test(`${how} cancels a confirmation`, async ({ page }) => {
      let deletes = 0
      await page.route("**/api/instances/alpha", (route) => {
        if (route.request().method() !== "DELETE") return route.fallback()
        deletes++
        return route.fulfill({ json: {} })
      })
      await page.getByRole("main").getByText("Alpha Server").click()
      await page.locator("aside").getByRole("button", { name: "Delete" }).click()
      const question = page.getByText("permanently delete this instance")
      await expect(question).toBeVisible()
      await dismiss(page)
      await expect(question).toBeHidden()
      await expect(page.getByRole("heading", { name: "Alpha Server" })).toBeVisible()
      expect(deletes).toBe(0)
    })
  }

  test("Escape cancels a prompt without renaming", async ({ page }) => {
    let renamed = false
    await page.route("**/api/instances/alpha/rename", (route) => {
      renamed = true
      return route.fulfill({ json: { id: "alpha" } })
    })
    await page.getByRole("main").getByText("Alpha Server").click({ button: "right" })
    await page.getByRole("button", { name: "Rename" }).click()
    await page.locator("#dialog-input").fill("Something else")
    await page.keyboard.press("Escape")
    await expect(page.locator("#dialog-input")).toHaveCount(0)
    expect(renamed).toBe(false)
  })
})

test.describe("Edit window dismissal", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances/alpha/config", (route) =>
      route.fulfill({ json: { image: "itzg/minecraft-server", environment: { MOTD: "Hi" } } }),
    )
    await openDashboard(page)
    await openEdit(page)
  })

  test("Escape closes it when nothing changed", async ({ page }) => {
    await page.keyboard.press("Escape")
    await expect(editHeading(page)).toBeHidden()
  })

  test("a backdrop click closes it", async ({ page }) => {
    await clickBackdrop(page)
    await expect(editHeading(page)).toBeHidden()
  })

  test("Escape with unsaved changes asks first, and a second Escape keeps editing", async ({ page }) => {
    await page.getByRole("button", { name: "Configuration" }).click()
    await page.getByLabel("Value of MOTD").fill("Changed")
    await page.keyboard.press("Escape")
    await expect(page.getByText("Discard 1 unsaved change?")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByText("Discard 1 unsaved change?")).toBeHidden()
    await expect(page.getByLabel("Value of MOTD")).toHaveValue("Changed")
  })

  test("a backdrop click with unsaved changes asks first", async ({ page }) => {
    await page.getByRole("button", { name: "Configuration" }).click()
    await page.getByLabel("Value of MOTD").fill("Changed")
    await clickBackdrop(page)
    await page.getByRole("button", { name: "Discard" }).click()
    await expect(editHeading(page)).toBeHidden()
  })

  test("Escape in a new-folder name cancels the name, not the window", async ({ page }) => {
    await page.getByRole("button", { name: "Files", exact: true }).click()
    await page.getByTitle("New Folder").click()
    const name = page.getByPlaceholder("Folder name...")
    await expect(name).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(name).toBeHidden()
    await expect(editHeading(page)).toBeVisible()
  })
})

test.describe("Edit window dismissal on the Mods tab", () => {
  test("Escape clears a mod selection before it closes the window", async ({ page }) => {
    await page.route("**/api/instances/alpha/mods", (route) =>
      route.fulfill({
        json: [{ filename: "apple.jar", id: "apple", name: "Apple Mod", version: "1.0", enabled: true, size: 1, modified: 0, modified_str: "", source: "local" }],
      }),
    )
    await page.route("**/api/instances/alpha/config", (route) =>
      route.fulfill({ json: { image: "itzg/minecraft-server", environment: { TYPE: "FABRIC" } } }),
    )
    await openDashboard(page)
    await openEdit(page)
    await page.getByRole("button", { name: "Mods", exact: true }).click()
    const row = page.getByRole("row", { name: /Apple Mod/ })
    await row.click()
    await expect(row).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("Escape")
    await expect(row).toHaveAttribute("aria-selected", "false")
    await expect(editHeading(page)).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(editHeading(page)).toBeHidden()
  })
})
