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
    for (const tab of ["Loaders", "Mods"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole("button", { name: "Add-ons", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Resource Packs", exact: true })).toBeVisible()

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

test.describe("Bedrock Add-ons tab", () => {
  const BP = "11111111-1111-4111-8111-111111111111"
  let addons: Record<string, unknown>[]
  let uploads: string[]
  let toggles: { uuid: string; enabled: boolean }[]
  let deletes: { uuid: string }[]

  const addon = (overrides: Record<string, unknown> = {}) => ({
    uuid: BP, name: "Mob Pack", description: "More mobs", version: "1.2.3", type: "behavior", folder: "Mob_Pack_11111111",
    enabled: true, beta_apis: [], missing_dependencies: [], error: null, ...overrides,
  })

  async function openAddons(page: Page, installed: Record<string, unknown>[] = []) {
    addons = installed
    uploads = []
    toggles = []
    deletes = []
    await page.route("**/api/instances/alpha/config", (route) =>
      route.fulfill({ json: { image: "itzg/minecraft-bedrock-server", environment: { TYPE: "BEDROCK" } } }),
    )
    await page.route("**/api/instances/alpha/addons**", (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      if (path.endsWith("/upload")) {
        const name = /filename="([^"]+)"/.exec(req.postDataBuffer()?.toString("latin1") || "")?.[1] || ""
        uploads.push(name)
        if (name.startsWith("evil")) {
          return route.fulfill({ status: 400, json: { detail: `${name} wasn't installed. It contains an unsafe path (../x), so it wasn't installed.` } })
        }
        addons = [addon(), addon({ uuid: "22222222-2222-4222-8222-222222222222", name: "Mob Textures", type: "resource", folder: "Mob_Textures_22222222" })]
        return route.fulfill({ json: { message: `Installed ${name}`, installed: [] } })
      }
      if (path.endsWith("/toggle")) {
        const body = req.postDataJSON()
        toggles.push(body)
        addons = addons.map((a) => (a.uuid === body.uuid ? { ...a, enabled: body.enabled } : a))
        return route.fulfill({ json: { message: "ok" } })
      }
      if (path.endsWith("/delete")) {
        const body = req.postDataJSON()
        deletes.push(body)
        addons = addons.filter((a) => a.uuid !== body.uuid)
        return route.fulfill({ json: { message: "ok" } })
      }
      return route.fulfill({ json: { world: "Bedrock level", addons } })
    })
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Add-ons", exact: true }).click()
    await expect(page.getByTestId("bedrock-addons")).toBeVisible()
  }

  test("uploads a .mcaddon, lists the behavior pack here and the resource pack in Resource Packs", async ({ page }) => {
    await openAddons(page)
    await expect(page.getByText("No add-ons installed")).toBeVisible()
    await expect(page.getByText("World: Bedrock level")).toBeVisible()
    await page.getByTestId("addon-file-input").setInputFiles({ name: "mobs.mcaddon", mimeType: "application/zip", buffer: Buffer.from("PK") })

    await expect(page.getByTestId("addon-row")).toHaveCount(1)
    expect(uploads).toEqual(["mobs.mcaddon"])
    await expect(page.getByText("Add-ons (1 installed)")).toBeVisible()
    const row = page.getByTestId("addon-row")
    await expect(row).toContainText("Mob Pack")
    await expect(row).toContainText("1.2.3")
    await expect(row).toContainText("Behavior pack")

    await page.getByRole("button", { name: "Resource Packs", exact: true }).click()
    await expect(page.getByTestId("bedrock-resource-packs")).toBeVisible()
    await expect(page.getByTestId("addon-row")).toHaveCount(1)
    await expect(page.getByTestId("addon-row")).toContainText("Mob Textures")
  })

  test("disables and removes an add-on", async ({ page }) => {
    await openAddons(page, [addon()])
    const toggle = page.getByRole("switch", { name: "Enable Mob Pack" })
    await expect(toggle).toHaveAttribute("aria-checked", "true")
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(toggles).toEqual([{ uuid: BP, enabled: false }])

    await page.getByRole("button", { name: "Remove Mob Pack" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByTestId("addon-row")).toHaveCount(0)
    expect(deletes).toEqual([{ uuid: BP }])
  })

  test("a rejected archive shows the server's reason", async ({ page, errors }) => {
    errors.expect(/400/)
    await openAddons(page)
    await page.getByTestId("addon-file-input").setInputFiles({ name: "evil.mcpack", mimeType: "application/zip", buffer: Buffer.from("PK") })
    await expect(page.getByText("evil.mcpack wasn't installed. It contains an unsafe path")).toBeVisible()
    await expect(page.getByTestId("addon-row")).toHaveCount(0)
  })

  test("warns about Beta APIs and missing packs", async ({ page }) => {
    await openAddons(page, [addon({ beta_apis: ["@minecraft/server"], missing_dependencies: ["22222222-2222-4222-8222-222222222222"] })])
    const row = page.getByTestId("addon-row")
    await expect(row).toContainText("Beta APIs experiment")
    await expect(row).toContainText("Needs a pack that isn't installed")
  })
})

test.describe("Bedrock Resource Packs tab", () => {
  const RP = "22222222-2222-4222-8222-222222222222"
  let addons: Record<string, unknown>[]
  let uploads: { name: string; type: string | undefined }[]
  let deletes: { uuid: string }[]
  let puts: { environment: Record<string, string> }[]

  const pack = (overrides: Record<string, unknown> = {}) => ({
    uuid: RP, name: "Crisp Textures", description: "Sharper blocks", version: "2.0.0", type: "resource", folder: "Crisp_Textures_22222222",
    enabled: true, beta_apis: [], missing_dependencies: [], error: null, ...overrides,
  })

  async function openResourcePacks(page: Page, installed: Record<string, unknown>[] = [], environment: Record<string, string> = {}) {
    addons = installed
    uploads = []
    deletes = []
    puts = []
    await page.route("**/api/instances/alpha/config", (route) => {
      if (route.request().method() === "PUT") {
        puts.push(route.request().postDataJSON())
        return route.fulfill({ json: { message: "Config updated" } })
      }
      return route.fulfill({ json: { image: "itzg/minecraft-bedrock-server", environment: { TYPE: "BEDROCK", ...environment } } })
    })
    await page.route("**/api/instances/alpha/addons**", (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      if (path.endsWith("/upload")) {
        const body = req.postDataBuffer()?.toString("latin1") || ""
        const name = /filename="([^"]+)"/.exec(body)?.[1] || ""
        const type = /name="type"\r\n\r\n([^\r]+)/.exec(body)?.[1]
        uploads.push({ name, type })
        if (name.startsWith("behavior")) {
          return route.fulfill({ status: 400, json: { detail: `${name} wasn't installed. It's a behavior pack, not a resource pack. Install it from the Add-ons tab.` } })
        }
        addons = [pack()]
        return route.fulfill({ json: { message: `Installed ${name}`, installed: [] } })
      }
      if (path.endsWith("/delete")) {
        const body = req.postDataJSON()
        deletes.push(body)
        addons = addons.filter((a) => a.uuid !== body.uuid)
        return route.fulfill({ json: { message: "ok" } })
      }
      return route.fulfill({ json: { world: "Bedrock level", addons } })
    })
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Resource Packs", exact: true }).click()
    await expect(page.getByTestId("bedrock-resource-packs")).toBeVisible()
  }

  test("uploads a .mcpack as a resource pack and lists it", async ({ page }) => {
    await openResourcePacks(page, [{ ...pack({ uuid: "11111111-1111-4111-8111-111111111111", name: "Mob Pack", type: "behavior" }) }])
    await expect(page.getByText("No resource packs installed")).toBeVisible()
    await expect(page.getByText("Search Resource Packs")).toHaveCount(0)
    await expect(page.getByTestId("addon-file-input")).toHaveAttribute("accept", ".mcpack")
    await page.getByTestId("addon-file-input").setInputFiles({ name: "crisp.mcpack", mimeType: "application/zip", buffer: Buffer.from("PK") })

    await expect(page.getByTestId("addon-row")).toHaveCount(1)
    expect(uploads).toEqual([{ name: "crisp.mcpack", type: "resource" }])
    await expect(page.getByText("Resource Packs (1 installed)")).toBeVisible()
    await expect(page.getByTestId("addon-row")).toContainText("Crisp Textures")
    await expect(page.getByTestId("addon-row")).toContainText("2.0.0")
  })

  test("a behavior pack is refused with a pointer to Add-ons", async ({ page, errors }) => {
    errors.expect(/400/)
    await openResourcePacks(page)
    await page.getByTestId("addon-file-input").setInputFiles({ name: "behavior.mcpack", mimeType: "application/zip", buffer: Buffer.from("PK") })
    await expect(page.getByText("Install it from the Add-ons tab")).toBeVisible()
    await expect(page.getByTestId("addon-row")).toHaveCount(0)
  })

  test("removes a resource pack", async ({ page }) => {
    await openResourcePacks(page, [pack()])
    await page.getByRole("button", { name: "Remove Crisp Textures" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByTestId("addon-row")).toHaveCount(0)
    expect(deletes).toEqual([{ uuid: RP }])
  })

  test("Require pack saves TEXTUREPACK_REQUIRED", async ({ page }) => {
    await openResourcePacks(page, [pack()], { TEXTUREPACK_REQUIRED: "false" })
    const toggle = page.getByRole("switch", { name: "Require pack" })
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-checked", "true")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()

    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].environment).toMatchObject({ TYPE: "BEDROCK", TEXTUREPACK_REQUIRED: "true" })
  })
})
