import { test, expect, MOCK_INSTANCES } from "./fixtures"

// Unreachable requests log console errors; these tests cause them on purpose.
const UNREACHABLE = /Failed to load resource|Failed to fetch/

test.describe("Lost connection to the backend", () => {
  test.beforeEach(async ({ errors }) => {
    errors.expect(UNREACHABLE)
  })

  test("a failed first load says the backend is unreachable, and Retry recovers", async ({ page }) => {
    await page.route("**/api/instances", (route) => route.abort())
    await page.goto("/")
    await expect(page.getByText("Can't reach Isopod")).toBeVisible()
    await expect(page.getByText(/No instances found/)).toHaveCount(0)

    await page.unroute("**/api/instances")
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
    await expect(page.getByText("Can't reach Isopod")).toHaveCount(0)
  })

  test("losing the backend marks statuses unknown, and the dashboard recovers on its own", async ({ page }) => {
    test.setTimeout(60_000)
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: true, is_ready: true, containers: [] } }),
    )
    await page.goto("/")
    await expect(page.getByText("Online", { exact: true })).toBeVisible()

    await page.route("**/api/health", (route) => route.abort())
    await expect(page.getByText(/Lost connection to Isopod/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Online", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("paragraph").filter({ hasText: /^Unknown$/ })).toBeVisible()

    await page.unroute("**/api/health")
    await expect(page.getByText(/Lost connection to Isopod/)).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText("Online", { exact: true })).toBeVisible()
  })
})
