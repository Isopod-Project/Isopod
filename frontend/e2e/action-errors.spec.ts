import { test, expect, MOCK_INSTANCES } from "./fixtures"

// Failed requests show up as console errors; these tests cause them on purpose.
const FAILED_REQUEST = /Failed to load resource|Files are in use|Restart failed|Failed to send command|Error syncing mods/

test.describe("Instance actions report failures", () => {
  test.beforeEach(async ({ errors }) => {
    errors.expect(FAILED_REQUEST)
  })

  test("a failed delete keeps the instance and shows the backend's reason", async ({ page }) => {
    await page.route("**/api/instances/alpha", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, json: { detail: "Files are in use" } })
        : route.fallback(),
    )
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.getByRole("button", { name: "Delete", exact: true }).first().click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText("The instance was not deleted: Files are in use")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
  })

  test("a failed duplicate says why", async ({ page }) => {
    await page.route("**/api/instances/alpha/duplicate", (route) =>
      route.fulfill({ status: 400, json: { detail: "An instance with that name already exists" } }),
    )
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click({ button: "right" })
    await page.getByRole("button", { name: "Duplicate" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText(/An instance with that name already exists/)).toBeVisible()
  })

  test.describe("on a running server", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/instances", (route) =>
        route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
      )
      await page.route("**/api/instances/*/status", (route) =>
        route.fulfill({ json: { instance_id: "alpha", is_running: true, is_ready: true, containers: [] } }),
      )
      await page.route("**/api/instances/alpha/config", (route) =>
        route.fulfill({ json: { environment: { TYPE: "FABRIC" }, ports: [], volumes: [] } }),
      )
      await page.goto("/")
      await page.getByRole("main").getByText("Alpha Server").click()
      await page.getByRole("button", { name: "Edit" }).first().click()
    })

    test("restart stops at the step that failed", async ({ page }) => {
      let startCalled = false
      await page.route("**/api/instances/alpha/stop", (route) =>
        route.fulfill({ status: 500, json: { detail: "docker compose down timed out" } }),
      )
      await page.route("**/api/instances/alpha/start", (route) => {
        startCalled = true
        return route.fulfill({ json: {} })
      })
      await page.getByRole("region", { name: "Server controls" }).getByRole("button", { name: "Restart", exact: true }).click()
      await expect(page.getByText("Restart Error: docker compose down timed out")).toBeVisible()
      expect(startCalled).toBe(false)
    })

    test("a failed console command stays in the box and logs an error", async ({ page }) => {
      await page.route("**/api/instances/alpha/command", (route) =>
        route.fulfill({ json: { output: "Failed to connect to RCON", success: false } }),
      )
      await page.getByRole("button", { name: "Minecraft Log" }).click()
      const input = page.getByPlaceholder("Type a command (whitelist, op, kick...)")
      await input.fill("say hello")
      await input.press("Enter")
      await expect(page.getByText("[Isopod] Command failed.")).toBeVisible()
      await expect(input).toHaveValue("say hello")
    })

    test("a successful console command clears the box", async ({ page }) => {
      await page.route("**/api/instances/alpha/command", (route) =>
        route.fulfill({ json: { output: "There are 0 of a max of 20 players online", success: true } }),
      )
      await page.getByRole("button", { name: "Minecraft Log" }).click()
      const input = page.getByPlaceholder("Type a command (whitelist, op, kick...)")
      await input.fill("list")
      await input.press("Enter")
      await expect(page.getByText("There are 0 of a max of 20 players online")).toBeVisible()
      await expect(input).toHaveValue("")
    })

    test("check for updates reports what it downloaded", async ({ page }) => {
      await page.route("**/api/instances/alpha/mods/sync", (route) =>
        route.fulfill({ json: { message: "ok", downloaded: ["sodium"], failed: ["lithium"] } }),
      )
      await page.getByRole("button", { name: "Mods", exact: true }).click()
      await page.getByRole("button", { name: "Check for Updates" }).click()
      await expect(page.getByText("Downloaded 1 missing mod: sodium.")).toBeVisible()
      await expect(page.getByText("Could not download: lithium.")).toBeVisible()
    })
  })
})
