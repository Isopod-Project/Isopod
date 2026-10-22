import { test, expect, MOCK_INSTANCES } from "./fixtures"

test.describe("Online players", () => {
  let actions: { name: string; body: Record<string, string> }[]
  let bans: { name: string; reason: string; created: string; source: string }[]

  test.beforeEach(async ({ page }) => {
    actions = []
    bans = [{ name: "Griefer", reason: "Burned the village", created: "2026-10-20 18:00:00 +0000", source: "Rcon" }]
    await page.route("**/api/instances/alpha/bans", (route) => route.fulfill({ json: bans }))
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
      const body = route.request().postDataJSON()
      actions.push({ name, body })
      if (body.action === "pardon") bans = bans.filter((b) => b.name !== name)
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

  test.describe("in User Management", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/instances/alpha/config", (route) =>
        route.fulfill({ json: { environment: { ENABLE_WHITELIST: "false" }, ports: [], volumes: [] } }),
      )
      await page.getByRole("main").getByText("Alpha Server").click()
      await page.getByRole("button", { name: "Edit" }).first().click()
      await page.getByRole("button", { name: "User Management", exact: true }).click()
    })

    test("unbanning removes the player from the ban list", async ({ page }) => {
      const banned = page.getByTestId("banned-players")
      await expect(banned).toContainText("Griefer")
      await expect(banned).toContainText("Burned the village")
      await banned.getByRole("button", { name: "Unban" }).click()
      await page.getByRole("button", { name: "OK" }).click()
      await expect.poll(() => actions).toEqual([{ name: "Griefer", body: { action: "pardon" } }])
      await expect(banned).toContainText("Nobody is banned.")
    })

    test("a banned managed player can be unbanned from their row", async ({ page }) => {
      bans = [{ name: "Alex", reason: "", created: "2026-10-20 18:00:00 +0000", source: "Rcon" }]
      await page.getByRole("button", { name: "User Management", exact: true }).click()
      const row = page.getByRole("row", { name: /Alex/ })
      await expect(row.getByTestId("user-banned")).toBeVisible()
      await expect(row.getByRole("button", { name: "Ban", exact: true })).toHaveCount(0)
      await row.getByRole("button", { name: "Unban" }).click()
      await page.getByRole("button", { name: "OK" }).click()
      await expect.poll(() => actions).toEqual([{ name: "Alex", body: { action: "pardon" } }])
      await expect(row.getByTestId("user-banned")).toHaveCount(0)
      await expect(row.getByRole("button", { name: "Ban", exact: true })).toBeVisible()
    })

    test("managed players show online status and live actions", async ({ page }) => {
      const row = page.getByRole("row", { name: /Alex/ })
      await expect(row.getByTestId("user-online")).toBeVisible()
      await row.getByRole("button", { name: "Kick" }).click()
      await page.getByRole("button", { name: "OK" }).click()
      await expect.poll(() => actions).toEqual([{ name: "Alex", body: { action: "kick", reason: "" } }])
    })
  })
})
