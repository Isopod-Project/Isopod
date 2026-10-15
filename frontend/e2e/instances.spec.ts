import { test, expect } from "./fixtures"

test.describe("Instance selection and sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Beta Server").first()).toBeVisible()
  })

  test("clicking a card populates the sidebar with that instance", async ({ page, errors }) => {
    await page.getByText("Beta Server").first().click()
    await expect(page.getByRole("heading", { name: "Beta Server" })).toBeVisible()
    expect(errors.problems).toEqual([])
  })

  test("selecting another card switches the sidebar", async ({ page }) => {
    await page.getByText("Beta Server").first().click()
    await expect(page.getByRole("heading", { name: "Beta Server" })).toBeVisible()
    await page.getByText("Alpha Server").first().click()
    await expect(page.getByRole("heading", { name: "Alpha Server" })).toBeVisible()
  })

  // TODO(#71): the app has no Escape handler for modals yet; enable once implemented.
  test.fixme("Escape closes the Settings modal", async ({ page }) => {
    await page.getByRole("button", { name: /^Settings$/ }).click()
    await expect(page.getByText("Application Settings")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByText("Application Settings")).toBeHidden()
  })
})
