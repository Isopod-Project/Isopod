import { test, expect, MOCK_INSTANCES } from "./fixtures"

test.describe("Top navigation bar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
  })

  test("renders the instance list from the backend", async ({ page, errors }) => {
    for (const inst of MOCK_INSTANCES) {
      await expect(page.getByRole("main").getByText(inst.name)).toBeVisible()
    }
    expect(errors.problems).toEqual([])
  })

  test("Refresh button re-requests the instance list", async ({ page }) => {
    const requests: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/instances") && req.method() === "GET") requests.push(req.url())
    })
    await page.getByRole("button", { name: /Refresh/ }).click()
    await expect.poll(() => requests.length).toBeGreaterThan(0)
  })

  test("Settings button opens the Application Settings modal", async ({ page }) => {
    await page.getByRole("button", { name: /^Settings$/ }).click()
    await expect(page.getByText("Application Settings")).toBeVisible()
  })

  test("Add Instance button opens the Add modal", async ({ page }) => {
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await expect(page.getByRole("button", { name: /Custom Instance|Custom/ }).first()).toBeVisible()
  })

  test("Folders button opens the global file browser", async ({ page }) => {
    await page.getByRole("button", { name: /Folders/ }).click()
    await expect(page.getByRole("button", { name: /Folders/ })).toBeVisible()
  })
})

test.describe("Application Settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /^Settings$/ }).click()
    await expect(page.getByText("Application Settings")).toBeVisible()
  })

  test("sidebar switches between preference tabs", async ({ page, errors }) => {
    await page.getByRole("button", { name: "Appearance", exact: true }).click()
    await expect(page.getByText("Customize the look and feel of Isopod.")).toBeVisible()
    await page.getByRole("button", { name: "Language", exact: true }).click()
    await page.getByRole("button", { name: "General", exact: true }).click()
    expect(errors.problems).toEqual([])
  })

  test("theme buttons update the data-theme attribute", async ({ page }) => {
    await page.getByRole("button", { name: "Appearance", exact: true }).click()
    await page.getByRole("button", { name: /Light Mode/ }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
    await page.getByRole("button", { name: /Dark Mode/ }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  })

  test("close button dismisses the modal", async ({ page }) => {
    await page.locator(".z-\\[110\\]").locator("button:has(svg.lucide-x)").first().click()
    await expect(page.getByText("Application Settings")).toBeHidden()
  })
})
