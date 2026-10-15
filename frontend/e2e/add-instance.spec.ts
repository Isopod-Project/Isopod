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
