import { test, expect, MOCK_INSTANCES } from "./fixtures"

const GB = 1024 ** 3

test.describe("Resource usage", () => {
  test.beforeEach(async ({ page }) => {
    // Status is only fetched for instances with a compose file.
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) => {
      const running = route.request().url().includes("/alpha/")
      route.fulfill({ json: { instance_id: "x", is_running: running, is_ready: running, containers: [] } })
    })
    await page.route("**/api/resources", (route) =>
      route.fulfill({
        json: {
          instances: { alpha: { cpu_percent: 7.3, memory_used: 1.5 * GB, memory_allocated: 2 * GB } },
          total: { cpu_percent: 7.3, memory_used: 1.5 * GB, memory_allocated: 2 * GB, host_memory: 16 * GB, host_cpus: 8 },
        },
      }),
    )
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
  })

  test("side panel shows CPU and RAM for the selected running server", async ({ page, errors }) => {
    const panel = page.getByTestId("instance-resources")
    await expect(panel).toContainText("7.3%")
    await expect(panel).toContainText("1.5 GB used · 2.0 GB heap")
    expect(errors.problems).toEqual([])
  })

  test("running server tile shows its RAM in use", async ({ page }) => {
    await expect(page.getByRole("main").getByText("1.5 GB")).toBeVisible()
  })

  test("side panel hides usage for a stopped server", async ({ page }) => {
    await page.getByRole("main").getByText("Beta Server").click()
    await expect(page.getByTestId("instance-resources")).toHaveCount(0)
  })
})
