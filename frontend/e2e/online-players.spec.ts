import { test, expect, MOCK_INSTANCES } from "./fixtures"

test.describe("Online players", () => {
  let actions: { name: string; body: Record<string, string> }[]

  test.beforeEach(async ({ page }) => {
    actions = []
    // Status is only fetched for instances with a compose file.
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) => {
      const online = route.request().url().includes("/alpha/")
      route.fulfill({ json: { instance_id: "x", is_running: online, is_ready: online, containers: [] } })
    })
    await page.route("**/api/instances/*/players", (route) => {
      route.fulfill({ json: { available: true, online: 2, max: 20, players: ["Steve", "Alex"] } })
    })
    await page.route("**/api/instances/alpha/users", (route) =>
      route.fulfill({ json: [{ name: "Alex", uuid: "", level: 4, is_op: true, whitelisted: true, active: true }] }),
    )
    await page.route("**/api/instances/alpha/players/*/action", (route) => {
      const name = decodeURIComponent(route.request().url().split("/players/")[1].split("/")[0])
      actions.push({ name, body: route.request().postDataJSON() })
      route.fulfill({ json: { message: "Done" } })
    })
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
  })

  test("side panel lists who is online", async ({ page }) => {
    const panel = page.getByTestId("online-players")
    await expect(panel).toContainText("2/20")
    await expect(panel.getByRole("button", { name: "Steve" })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Alex" })).toBeVisible()
  })

  test("online server tile shows the player count", async ({ page }) => {
    await expect(page.getByRole("main").getByTestId("player-count")).toHaveText("2/20")
  })

  test("players are hidden for a server that isn't online", async ({ page }) => {
    await page.getByRole("main").getByText("Beta Server").click()
    await expect(page.getByTestId("online-players")).toHaveCount(0)
  })

  test("kick sends the reason", async ({ page }) => {
    const panel = page.getByTestId("online-players")
    await panel.getByRole("button", { name: "Steve" }).click()
    await panel.getByRole("button", { name: "Kick" }).click()
    await page.getByRole("textbox").fill("AFK")
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => actions).toEqual([{ name: "Steve", body: { action: "kick", reason: "AFK" } }])
  })

  test("op state comes from User Management", async ({ page }) => {
    const panel = page.getByTestId("online-players")
    await panel.getByRole("button", { name: "Alex" }).click()
    await panel.getByRole("button", { name: "Deop" }).click()
    await expect.poll(() => actions).toEqual([{ name: "Alex", body: { action: "deop" } }])
  })

  test("teleport offers the other online players", async ({ page }) => {
    const panel = page.getByTestId("online-players")
    await panel.getByRole("button", { name: "Steve" }).click()
    await panel.getByRole("button", { name: "Teleport" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => actions).toEqual([{ name: "Steve", body: { action: "teleport", target: "Alex" } }])
  })
})
