import { test, expect, MOCK_INSTANCES } from "./fixtures"

test.describe("Auto-pause", () => {
  test("a sleeping server shows as Sleeping and isn't asked for its players", async ({ page }) => {
    let playerRequests = 0
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[3]
      return route.fulfill({
        json: id === "alpha"
          ? { instance_id: "alpha", is_running: true, is_ready: true, is_paused: true, startup_status: "Sleeping", containers: [] }
          : { instance_id: id, is_running: false, is_ready: false, containers: [] },
      })
    })
    await page.route("**/api/instances/*/players", (route) => {
      playerRequests++
      return route.fulfill({ json: { available: true, online: 0, max: 20, players: [] } })
    })
    await page.goto("/")

    await expect(page.getByRole("main").getByTitle("Sleeping")).toBeVisible()
    await page.getByRole("main").getByText("Alpha Server").click()
    await expect(page.getByRole("complementary").getByText("Sleeping", { exact: true })).toBeVisible()
    expect(playerRequests).toBe(0)
  })

  test("turning on sleep when empty saves the autopause variables", async ({ page }) => {
    const puts: { environment: Record<string, string> }[] = []
    await page.route("**/api/instances/*/config", (route) => {
      if (route.request().method() === "PUT") {
        puts.push(route.request().postDataJSON())
        return route.fulfill({ json: { message: "Config updated" } })
      }
      return route.fulfill({ json: { image: "itzg/minecraft-server", environment: { VERSION: "1.21.4" }, restart_policy: "always" } })
    })
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Configuration" }).click()

    await expect(page.getByLabel("Minutes before sleeping")).toHaveCount(0)
    await page.getByLabel("Sleep when empty").check()
    await page.getByLabel("Minutes before sleeping").fill("15")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()

    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].environment).toMatchObject({ ENABLE_AUTOPAUSE: "TRUE", AUTOPAUSE_TIMEOUT_EST: "900" })
  })

  test("Bedrock servers don't offer it", async ({ page }) => {
    await page.route("**/api/instances/*/config", (route) =>
      route.fulfill({ json: { image: "itzg/minecraft-bedrock-server", environment: { TYPE: "BEDROCK", VERSION: "LATEST" } } }),
    )
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Configuration" }).click()
    await expect(page.getByLabel("Restart automatically")).toBeVisible()
    await expect(page.getByLabel("Sleep when empty")).toHaveCount(0)
  })
})
