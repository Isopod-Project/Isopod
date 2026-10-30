import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

test.describe("Bedrock in Add Instance", () => {
  let created: Record<string, unknown>[]

  test.beforeEach(async ({ page }) => {
    created = []
    await page.route("**/api/instances", (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      created.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: "pocket", name: "Pocket" } })
    })
    await page.goto("/")
    await expect(page.getByText("Alpha Server").first()).toBeVisible()
    await page.getByRole("button", { name: /Add Instance/ }).click()
    await expect(page.getByText("Server Type")).toBeVisible()
  })

  test("creates a Bedrock server on the Bedrock port with Bedrock world options", async ({ page }) => {
    const port = page.getByPlaceholder("25565")
    await expect(port).toHaveValue("25565")
    await page.getByRole("button", { name: "BEDROCK", exact: true }).click()
    await expect(port).toHaveValue("19132")
    await expect(page.getByRole("note")).toContainText("can't run Java mods or plugins")

    await page.getByRole("button", { name: /Preview/ }).click()
    await page.getByPlaceholder("e.g. My Modded World").fill("Pocket")
    await page.getByRole("button", { name: /Next/ }).click()

    await expect(page.getByRole("option", { name: "Spectator" })).toHaveCount(0)
    await expect(page.getByRole("option", { name: /Legacy/ })).toHaveCount(1)
    await expect(page.getByText("Structures")).toHaveCount(0)
    await expect(page.getByPlaceholder("Enter Xbox gamertag...")).toBeVisible()

    await page.getByRole("button", { name: "Create Instance" }).click()
    await expect.poll(() => created.length).toBe(1)
    expect(created[0]).toMatchObject({ template: "bedrock", port: 19132, version: "PREVIEW" })
  })

  test("switching back to a Java type restores the Java port", async ({ page }) => {
    const port = page.getByPlaceholder("25565")
    await page.getByRole("button", { name: "BEDROCK", exact: true }).click()
    await expect(port).toHaveValue("19132")
    await page.getByRole("button", { name: "PAPER", exact: true }).click()
    await expect(port).toHaveValue("25565")
    await expect(page.getByText("Minecraft Version")).toBeVisible()
  })
})

test.describe("Bedrock and cross-play in the Edit window", () => {
  let puts: { environment: Record<string, string> }[]

  async function openEdit(page: Page, environment: Record<string, string>, status: Record<string, unknown> = {}) {
    puts = []
    await page.route("**/api/instances/*/config", (route) => {
      if (route.request().method() === "PUT") {
        puts.push(route.request().postDataJSON())
        return route.fulfill({ json: { message: "Config updated" } })
      }
      return route.fulfill({ json: { image: "itzg/minecraft-server", environment } })
    })
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: false, is_ready: false, containers: [], ...status } }),
    )
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
  }

  test("a Bedrock server hides the Java-only tabs and picks Bedrock versions", async ({ page }) => {
    await openEdit(page, { TYPE: "BEDROCK", VERSION: "LATEST", GAMEMODE: "creative", LEVEL_SEED: "42" })
    for (const tab of ["Loaders", "Mods", "Resource Packs"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toHaveCount(0)
    }

    await page.getByRole("button", { name: "World", exact: true }).click()
    await expect(page.locator("select").filter({ hasText: "Survival" })).toHaveValue("creative")
    await expect(page.getByPlaceholder("Random Seed")).toHaveValue("42")

    await page.getByRole("button", { name: "Versions", exact: true }).click()
    await page.getByRole("button", { name: /Preview/ }).click()
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].environment).toMatchObject({ TYPE: "BEDROCK", VERSION: "PREVIEW" })
  })

  test("turning on cross-play for a Paper server saves the toggle and port", async ({ page }) => {
    await openEdit(page, { TYPE: "PAPER", VERSION: "1.21.4" })
    await page.getByRole("button", { name: "Loaders", exact: true }).click()
    await page.getByRole("switch", { name: "Bedrock cross-play" }).click()
    await page.getByLabel("Bedrock port (UDP)").fill("19140")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()

    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].environment).toMatchObject({ TYPE: "PAPER", ISOPOD_CROSSPLAY: "true", ISOPOD_BEDROCK_PORT: "19140" })
  })

  test("cross-play can't be turned on for Forge, and switching to Forge turns it off", async ({ page }) => {
    await openEdit(page, { TYPE: "FABRIC", VERSION: "1.21.4", ISOPOD_CROSSPLAY: "true", ISOPOD_BEDROCK_PORT: "19132" })
    await page.getByRole("button", { name: "Loaders", exact: true }).click()
    const toggle = page.getByRole("switch", { name: "Bedrock cross-play" })
    await expect(toggle).toHaveAttribute("aria-checked", "true")
    await expect(page.getByTestId("crossplay-card")).toContainText("Fabric API is added")

    await page.getByText("Forge", { exact: true }).click()
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    await expect(toggle).toBeDisabled()
    await expect(page.getByTestId("crossplay-card")).toContainText("available on Paper, Purpur, Fabric, and NeoForge")
  })

  test("the sidebar shows the Bedrock address of a cross-play server", async ({ page }) => {
    await openEdit(page, { TYPE: "PAPER" }, { type: "PAPER", port: 25565, bedrock_port: 19133, public_ip: "203.0.113.5" })
    await expect(page.getByTestId("bedrock-address")).toContainText("203.0.113.5:19133")
  })
})

test.describe("Bedrock User Management", () => {
  let saves: { users: Record<string, unknown>[]; whitelist_enabled: boolean }[]
  let lookups: string[]

  test.beforeEach(async ({ page }) => {
    saves = []
    lookups = []
    await page.route("**/api/instances/alpha/config", (route) =>
      route.fulfill({ json: { image: "itzg/minecraft-bedrock-server", environment: { TYPE: "BEDROCK", ALLOW_LIST: "true", ALLOW_LIST_USERS: "Blocky Builder" } } }),
    )
    await page.route("**/api/instances/alpha/users", (route) => {
      if (route.request().method() === "PUT") {
        saves.push(route.request().postDataJSON())
        return route.fulfill({
          json: { message: "Users updated successfully", whitelist_enabled: true, environment: { ALLOW_LIST: "true", ALLOW_LIST_USERS: "Blocky Builder,Steve Two", OPS: "Steve Two" } },
        })
      }
      return route.fulfill({
        headers: { "X-Whitelist-Enabled": "true" },
        json: [{ name: "Blocky Builder", uuid: null, xuid: "2535400000000001", level: 0, is_op: false, whitelisted: true, active: true }],
      })
    })
    await page.route(/playerdb\.co/, (route) => {
      lookups.push(route.request().url())
      return route.fulfill({ json: {} })
    })
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "User Management", exact: true }).click()
  })

  test("lists the allowlist by gamertag and hides the Java-only controls", async ({ page }) => {
    await expect(page.getByText("Blocky Builder", { exact: true })).toBeVisible()
    await expect(page.getByText("XUID 2535400000000001")).toBeVisible()
    await expect(page.getByRole("button", { name: "ALLOWLISTED", exact: true })).toBeVisible()
    await expect(page.getByLabel("Permission for Blocky Builder")).toHaveValue("0")
    await expect(page.getByRole("option", { name: /Level 2/ })).toHaveCount(0)
    await expect(page.getByText(/Banned Players \(/)).toHaveCount(0)
    await expect(page.getByRole("note").filter({ hasText: "no ban command" })).toBeVisible()
  })

  test("adds a gamertag with a space, makes them operator and saves", async ({ page }) => {
    await page.getByPlaceholder("Xbox gamertag...").fill("Steve Two")
    await page.getByRole("button", { name: "Add Player" }).click()
    await page.getByLabel("Permission for Steve Two").selectOption("4")
    await page.getByRole("button", { name: "Save User Configuration" }).click()
    await expect(page.getByText("Allowlist and operators saved.")).toBeVisible()

    expect(saves).toHaveLength(1)
    expect(saves[0].whitelist_enabled).toBe(true)
    expect(saves[0].users).toEqual([
      expect.objectContaining({ name: "Blocky Builder", is_op: false, whitelisted: true }),
      expect.objectContaining({ name: "Steve Two", is_op: true, level: 4, whitelisted: true }),
    ])
    // A gamertag isn't looked up as a Java account
    expect(lookups).toEqual([])
  })

  test("shows the server's error when a gamertag is rejected", async ({ page, errors }) => {
    await page.unroute("**/api/instances/alpha/users")
    await page.route("**/api/instances/alpha/users", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 400, json: { detail: "\"a,b\" isn't a valid Xbox gamertag." } })
        : route.fulfill({ headers: { "X-Whitelist-Enabled": "false" }, json: [] }),
    )
    errors.expect(/400/)
    await page.getByRole("button", { name: "Save User Configuration" }).click()
    await expect(page.getByText("isn't a valid Xbox gamertag")).toBeVisible()
  })
})
