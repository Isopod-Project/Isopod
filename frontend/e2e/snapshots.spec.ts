import { test, expect, MOCK_INSTANCES } from "./fixtures"

const PENDING = { name: "snapshot-20261023-120000.zip", reason: "Before changing Minecraft version 1.21.1 → 1.21.4" }

test.describe("Restore previous state after an update", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
  })

  test("rolls back to the pending snapshot, stopping the server first", async ({ page }) => {
    let pending: typeof PENDING | null = PENDING
    let running = true
    const calls: string[] = []
    await page.route("**/api/instances/alpha/status", (route) =>
      route.fulfill({
        json: { instance_id: "alpha", is_running: running, is_ready: false, containers: [], pending_snapshot: pending },
      }),
    )
    await page.route("**/api/instances/alpha/stop", (route) => {
      calls.push("stop")
      running = false
      return route.fulfill({ json: {} })
    })
    await page.route("**/api/instances/alpha/backups/*/restore", (route) => {
      calls.push(`restore ${decodeURIComponent(new URL(route.request().url()).pathname.split("/")[5])}`)
      pending = null
      return route.fulfill({ json: { restored: ["world"] } })
    })

    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    const card = page.getByRole("region", { name: "Previous state" })
    await expect(card).toContainText("before changing Minecraft version 1.21.1 → 1.21.4")

    await card.getByRole("button", { name: "Restore previous state" }).click()
    await expect(page.getByText(/The server will be stopped first/)).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText("Restored the previous state. Start the server when you're ready.")).toBeVisible()
    expect(calls).toEqual(["stop", `restore ${PENDING.name}`])

    await page.getByRole("button", { name: "OK" }).click()
    await expect(card).toHaveCount(0)
  })

  test("Dismiss hides the offer", async ({ page }) => {
    let pending: typeof PENDING | null = PENDING
    await page.route("**/api/instances/alpha/status", (route) =>
      route.fulfill({
        json: { instance_id: "alpha", is_running: false, is_ready: false, containers: [], pending_snapshot: pending },
      }),
    )
    const dismissed = page.waitForRequest(
      (req) => req.url().endsWith("/api/instances/alpha/snapshots/pending") && req.method() === "DELETE",
    )
    await page.route("**/api/instances/alpha/snapshots/pending", (route) => {
      pending = null
      return route.fulfill({ json: { dismissed: true } })
    })

    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    const card = page.getByRole("region", { name: "Previous state" })
    await card.getByRole("button", { name: "Dismiss" }).click()
    await dismissed
    await expect(card).toHaveCount(0)
  })

  test("no offer without a pending snapshot", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await expect(page.getByRole("heading", { name: "Alpha Server" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Restore previous state" })).toHaveCount(0)
  })
})
