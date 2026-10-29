import { test, expect, MOCK_INSTANCES } from "./fixtures"

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
})

test.describe("Dashboard groups", () => {
  test("instances show under their group right after the page loads", async ({ page }) => {
    await page.route("**/api/groups", (route) => route.fulfill({ json: ["No group", "Survival"] }))
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => (inst.id === "beta" ? { ...inst, group: "Survival" } : inst)) }),
    )
    await page.goto("/")
    await expect(page.getByRole("main").getByText("Survival", { exact: true })).toBeVisible()
  })
})
