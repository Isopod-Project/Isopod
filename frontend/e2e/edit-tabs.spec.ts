import { test, expect, MOCK_INSTANCES } from "./fixtures"
import type { Page } from "@playwright/test"

const LOGS = [
  "[12:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.1",
  "[12:00:01] [Server thread/INFO]: Preparing spawn area",
  "[12:00:02] [Server thread/INFO]: Done (3.1s)! For help, type \"help\"",
  "[12:00:03] [Server thread/INFO]: Alex joined the game",
].join("\n")

const VERSIONS = [
  { id: "1.21.1", type: "release", releaseTime: "2024-08-08T00:00:00Z" },
  { id: "1.20.4", type: "release", releaseTime: "2023-12-07T00:00:00Z" },
]

const ENV = { TYPE: "FABRIC", VERSION: "1.20.4", MOTD: "Hi", SEED: "", MODRINTH_PROJECTS: "sodium" }

let configPuts: { environment: Record<string, string> }[]

async function openEdit(page: Page, env: Record<string, string> = ENV) {
  configPuts = []
  let saved = { image: "itzg/minecraft-server", environment: env }
  await page.route("**/api/instances/alpha/config", (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON()
      configPuts.push(saved)
      return route.fulfill({ json: { message: "Config updated", snapshot: null } })
    }
    return route.fulfill({ json: saved })
  })
  await page.route("**/api/meta/versions", (route) => route.fulfill({ json: { versions: VERSIONS } }))
  await page.goto("/")
  await page.getByRole("main").getByText("Alpha Server").click()
  await page.locator("aside").getByRole("button", { name: "Edit" }).click()
  await expect(page.getByRole("heading", { name: "Editing: Alpha Server" })).toBeVisible()
}

async function saveAndConfirm(page: Page) {
  await page.getByRole("button", { name: "Save Changes" }).click()
  await expect(page.getByText("Save changes to instance configuration?")).toBeVisible()
  await page.getByRole("button", { name: "OK" }).click()
  await expect.poll(() => configPuts.length).toBe(1)
  await page.getByRole("button", { name: "OK" }).click()
  return configPuts[0].environment
}

const selectWith = (page: Page, value: string) => page.locator("select").filter({ has: page.locator(`option[value="${value}"]`) })
const logBox = (page: Page) => page.locator("pre").first()

test.describe("Minecraft Log tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances/alpha/logs", (route) => route.fulfill({ json: { logs: LOGS } }))
    await openEdit(page)
  })

  test("Simplified hides routine lines that Verbose shows", async ({ page }) => {
    await expect(logBox(page)).toContainText("Alex joined the game")
    await expect(logBox(page)).not.toContainText("Preparing spawn area")
    await page.getByRole("button", { name: "Verbose" }).click()
    await expect(logBox(page)).toContainText("Preparing spawn area")
    await page.getByRole("button", { name: "Simplified" }).click()
    await expect(logBox(page)).not.toContainText("Preparing spawn area")
  })

  test("Wrap lines switches between wrapping and horizontal scrolling", async ({ page }) => {
    await expect(logBox(page)).toHaveClass(/whitespace-pre-wrap/)
    await page.getByLabel("Wrap lines").uncheck()
    await expect(logBox(page)).toHaveClass(/overflow-x-auto/)
    await expect(logBox(page)).not.toHaveClass(/whitespace-pre-wrap/)
  })

  test("Keep updating and Color lines can be turned off", async ({ page }) => {
    await page.getByLabel("Keep updating").uncheck()
    await expect(page.getByLabel("Keep updating")).not.toBeChecked()
    await page.getByLabel("Color lines").uncheck()
    await expect(page.getByLabel("Color lines")).not.toBeChecked()
  })

  test("Clear empties the view, and Refresh fetches the log again", async ({ page }) => {
    let fetches = 0
    await page.route("**/api/instances/alpha/logs", (route) => {
      fetches++
      return route.fulfill({ json: { logs: LOGS } })
    })
    await page.getByTitle("Clear console view").click()
    await expect(logBox(page)).not.toContainText("Alex joined the game")
    await page.getByTitle("Refresh logs from server").click()
    await expect.poll(() => fetches).toBeGreaterThan(0)
  })

  test("Search counts matches and Find steps through them", async ({ page }) => {
    await page.getByRole("button", { name: "Verbose" }).click()
    const search = page.getByPlaceholder("Search", { exact: true })
    await search.fill("Server thread")
    await expect(page.getByText("1 of 4")).toBeVisible()
    // The first Find jumps to the first match; later ones move on
    const find = page.getByRole("button", { name: "Find", exact: true })
    await find.click()
    await expect(page.getByText("1 of 4")).toBeVisible()
    await find.click()
    await expect(page.getByText("2 of 4")).toBeVisible()
    await search.press("Enter")
    await expect(page.getByText("3 of 4")).toBeVisible()
    await search.fill("creeper")
    await expect(page.getByText("No match")).toBeVisible()
    await expect(find).toBeDisabled()
  })

  test("Bottom scrolls to the end of the log", async ({ page, errors }) => {
    await page.getByRole("button", { name: "Bottom", exact: true }).click()
    expect(errors.problems).toEqual([])
  })
})

test.describe("Minecraft Log console", () => {
  let commands: string[]

  test.beforeEach(async ({ page }) => {
    commands = []
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: true, is_ready: true, containers: [] } }),
    )
    await page.route("**/api/instances/alpha/command", (route) => {
      commands.push(route.request().postDataJSON().command)
      return route.fulfill({ json: { output: "ok", success: true } })
    })
    await openEdit(page)
  })

  const input = (page: Page) => page.getByPlaceholder("Type a command (whitelist, op, kick...)")

  test("Enter and Send both run the command", async ({ page }) => {
    await input(page).fill("list")
    await input(page).press("Enter")
    await expect(input(page)).toHaveValue("")
    await input(page).fill("say hi")
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect.poll(() => commands).toEqual(["list", "say hi"])
  })

  test("Up and Down walk the command history and return to the draft", async ({ page }) => {
    for (const cmd of ["list", "say hi"]) {
      await input(page).fill(cmd)
      await input(page).press("Enter")
      await expect(input(page)).toHaveValue("")
    }
    await input(page).fill("half typed")
    await input(page).press("ArrowUp")
    await expect(input(page)).toHaveValue("say hi")
    await input(page).press("ArrowUp")
    await expect(input(page)).toHaveValue("list")
    // The oldest entry stays put
    await input(page).press("ArrowUp")
    await expect(input(page)).toHaveValue("list")
    await input(page).press("ArrowDown")
    await expect(input(page)).toHaveValue("say hi")
    await input(page).press("ArrowDown")
    await expect(input(page)).toHaveValue("half typed")
  })

  test("an empty command is not sent", async ({ page }) => {
    await input(page).press("Enter")
    await page.getByRole("button", { name: "Send", exact: true }).click()
    expect(commands).toEqual([])
  })

  test("the footer stops the server", async ({ page }) => {
    let stopped = false
    await page.route("**/api/instances/alpha/stop", (route) => {
      stopped = true
      return route.fulfill({ json: {} })
    })
    await page.getByRole("button", { name: "Stop Server" }).click()
    await expect.poll(() => stopped).toBe(true)
  })
})

test.describe("Edit footer on a stopped server", () => {
  test("Start Server launches it, and Console returns to the log", async ({ page }) => {
    let started = false
    await page.route("**/api/instances/alpha/start", (route) => {
      started = true
      return route.fulfill({ json: {} })
    })
    await openEdit(page)
    await page.getByRole("button", { name: "World", exact: true }).click()
    await page.getByRole("button", { name: "Console" }).click()
    await expect(page.getByPlaceholder("Type a command (whitelist, op, kick...)")).toBeVisible()
    await page.getByRole("button", { name: "Start Server" }).click()
    await expect.poll(() => started).toBe(true)
  })
})

test.describe("Versions tab", () => {
  let checks: unknown[]

  test.beforeEach(async ({ page }) => {
    checks = []
    await page.route("**/api/mods/check-compatibility", (route) => {
      checks.push(route.request().postDataJSON())
      return route.fulfill({
        json: { compatible: [{ id: "sodium", name: "Sodium", provider: "modrinth" }], incompatible: [] },
      })
    })
    await openEdit(page)
    await page.getByRole("button", { name: "Versions", exact: true }).click()
  })

  test("clicking a version checks mod compatibility, and Change saves the new version", async ({ page }) => {
    await page.getByText("1.21.1", { exact: true }).click()
    await expect(page.getByRole("heading", { name: "Change Minecraft Version" })).toBeVisible()
    await expect(page.getByText("1 Mods verified compatible.")).toBeVisible()
    expect(checks).toEqual([expect.objectContaining({ mc_version: "1.21.1", loader: "FABRIC", modrinth_ids: ["sodium"] })])

    await page.getByRole("button", { name: "Change to 1.21.1" }).click()
    await expect(page.getByRole("heading", { name: "Change Minecraft Version" })).toBeHidden()
    const env = await saveAndConfirm(page)
    expect(env).toMatchObject({ VERSION: "1.21.1", MODRINTH_PROJECTS: "sodium" })
  })

  test("Cancel leaves the version alone", async ({ page }) => {
    await page.getByText("1.21.1", { exact: true }).click()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("heading", { name: "Change Minecraft Version" })).toBeHidden()
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled()
  })

  test("Escape closes the version window but not the Edit window", async ({ page }) => {
    await page.getByText("1.21.1", { exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Change Minecraft Version" })).toBeHidden()
    await expect(page.getByRole("heading", { name: "Editing: Alpha Server" })).toBeVisible()
  })

  test("clicking the current version does nothing", async ({ page }) => {
    await page.getByText("1.20.4", { exact: true }).last().click()
    await expect(page.getByRole("heading", { name: "Change Minecraft Version" })).toHaveCount(0)
  })
})

test.describe("Loaders tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/api\/meta\/loaders\/fabric/i, (route) => route.fulfill({ json: [{ id: "0.16.5", stable: true }, { id: "0.16.4", stable: true }] }))
    await page.route(/\/api\/meta\/loaders\/quilt/i, (route) => route.fulfill({ json: [{ id: "0.27.0", stable: true }] }))
    await openEdit(page)
    await page.getByRole("button", { name: "Loaders", exact: true }).click()
  })

  test("pinning a loader version saves it under the loader's variable", async ({ page }) => {
    await page.getByText("0.16.4", { exact: true }).click()
    const env = await saveAndConfirm(page)
    expect(env).toMatchObject({ TYPE: "FABRIC", FABRIC_LOADER_VERSION: "0.16.4" })
  })

  test("switching loader saves the new TYPE", async ({ page }) => {
    await page.getByText("Quilt", { exact: true }).click()
    await expect(page.getByText("0.27.0", { exact: true })).toBeVisible()
    const env = await saveAndConfirm(page)
    expect(env.TYPE).toBe("QUILT")
  })

  test("Latest Recommended clears a pinned version", async ({ page }) => {
    await page.getByText("0.16.4", { exact: true }).click()
    await page.getByText("Latest Recommended").click()
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled()
  })
})

test.describe("World tab", () => {
  test("seed, level type, difficulty, game mode and structures are saved", async ({ page }) => {
    await openEdit(page)
    await page.getByRole("button", { name: "World", exact: true }).click()
    await page.getByPlaceholder("Random Seed").fill("12345")
    await selectWith(page, "AMPLIFIED").selectOption("AMPLIFIED")
    await selectWith(page, "peaceful").selectOption("peaceful")
    await selectWith(page, "adventure").selectOption("adventure")
    await page.getByRole("button", { name: "Enabled" }).click()
    await expect(page.getByRole("button", { name: "Disabled" })).toBeVisible()

    const env = await saveAndConfirm(page)
    expect(env).toMatchObject({
      SEED: "12345",
      LEVEL_TYPE: "AMPLIFIED",
      DIFFICULTY: "peaceful",
      MODE: "adventure",
      GENERATE_STRUCTURES: "false",
    })
  })
})

test.describe("Configuration tab", () => {
  test.beforeEach(async ({ page }) => {
    await openEdit(page)
    await page.getByRole("button", { name: "Configuration" }).click()
  })

  test("Save Changes is disabled until something changes", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled()
    await page.getByLabel("Value of MOTD").fill("Welcome")
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeEnabled()
  })

  test("an edited variable is saved after confirming", async ({ page }) => {
    await page.getByLabel("Value of MOTD").fill("Welcome")
    const env = await saveAndConfirm(page)
    expect(env.MOTD).toBe("Welcome")
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled()
  })

  test("cancelling the save sends nothing", async ({ page }) => {
    await page.getByLabel("Value of MOTD").fill("Welcome")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "Cancel" }).click()
    expect(configPuts).toEqual([])
    await expect(page.getByLabel("Value of MOTD")).toHaveValue("Welcome")
  })

  test("a failed save says why", async ({ page, errors }) => {
    errors.expect(/Failed to load resource/)
    await page.unroute("**/api/instances/alpha/config")
    await page.route("**/api/instances/alpha/config", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: { detail: "Disk full" } })
        : route.fallback(),
    )
    await page.getByLabel("Value of MOTD").fill("Welcome")
    await page.getByRole("button", { name: "Save Changes" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText(/Save Error: .*Disk full/)).toBeVisible()
  })
})

test.describe("Resource Packs tab", () => {
  const PACK = { id: "faithful", name: "Faithful 32x", author: "Faithful", summary: "Textures", downloads: 10, provider: "modrinth" }

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/mods/search/modrinth?**", (route) => route.fulfill({ json: [PACK] }))
    await page.route("**/api/mods/metadata?**", (route) => route.fulfill({ json: [] }))
    await openEdit(page)
    await page.getByRole("button", { name: "Resource Packs", exact: true }).click()
  })

  test("adding a pack from search stages it for saving", async ({ page }) => {
    await page.getByRole("button", { name: "Add Packs" }).click()
    await page.getByPlaceholder("Search for textures, packs, assets...").fill("faithful")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expect(page.getByText("Faithful 32x")).toBeVisible()
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(page.getByText("Added", { exact: true })).toBeVisible()

    const env = await saveAndConfirm(page)
    expect(env.RESOURCE_PACKS_MODRINTH).toBe("faithful")
  })

  test("Required makes players accept the pack, with the install message", async ({ page }) => {
    await page.getByRole("button", { name: "REQUIRED" }).click()
    await page.getByPlaceholder("Message shown when players join").fill("Please accept")
    const env = await saveAndConfirm(page)
    expect(env).toMatchObject({ RESOURCE_PACK_ENFORCE: "TRUE", RESOURCE_PACK_PROMPT: JSON.stringify({ text: "Please accept" }) })
  })
})

test.describe("User Management tab", () => {
  let saves: { users: { name: string; is_op: boolean; level: number; whitelisted: boolean; active: boolean }[]; whitelist_enabled: boolean }[]

  test.beforeEach(async ({ page }) => {
    saves = []
    await page.route("**/api/instances/alpha/users", (route) => {
      if (route.request().method() === "PUT") {
        saves.push(route.request().postDataJSON())
        return route.fulfill({ json: { message: "ok" } })
      }
      return route.fulfill({
        headers: { "X-Whitelist-Enabled": "true" },
        json: [
          { name: "Alex", uuid: "a", level: 0, is_op: false, whitelisted: true, active: true },
          { name: "Steve", uuid: "s", level: 4, is_op: true, whitelisted: true, active: true },
        ],
      })
    })
    await openEdit(page)
    await page.getByRole("button", { name: "User Management", exact: true }).click()
    await expect(page.getByText("Alex", { exact: true })).toBeVisible()
  })

  const playerRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) })

  async function save(page: Page) {
    await page.getByRole("button", { name: "Save User Configuration" }).click()
    await expect(page.getByText("User management and whitelist saved successfully.")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
    return saves[0]
  }

  test("adds a player and saves them on the whitelist", async ({ page }) => {
    await page.getByPlaceholder("Minecraft Gamertag...").fill("Herobrine")
    await page.getByRole("button", { name: "Add Player" }).click()
    await expect(playerRow(page, "Herobrine")).toBeVisible()
    const body = await save(page)
    expect(body.whitelist_enabled).toBe(true)
    expect(body.users.map((u) => u.name)).toEqual(["Alex", "Steve", "Herobrine"])
  })

  test("removing a player drops them from the save", async ({ page }) => {
    await playerRow(page, "Steve").getByTitle("Remove player").click()
    await expect(playerRow(page, "Steve")).toHaveCount(0)
    const body = await save(page)
    expect(body.users.map((u) => u.name)).toEqual(["Alex"])
  })

  test("operator level and access are saved", async ({ page }) => {
    await page.getByLabel("Permission for Alex").selectOption("4")
    await playerRow(page, "Steve").getByTitle("Click to deactivate player access").click()
    await expect(playerRow(page, "Steve").getByText("DEACTIVATED")).toBeVisible()
    const body = await save(page)
    expect(body.users).toEqual([
      expect.objectContaining({ name: "Alex", is_op: true, level: 4 }),
      expect.objectContaining({ name: "Steve", active: false }),
    ])
  })

  test("Discard Changes reloads the saved list", async ({ page }) => {
    await playerRow(page, "Steve").getByTitle("Remove player").click()
    await page.getByRole("button", { name: "Discard Changes" }).click()
    await expect(playerRow(page, "Steve")).toBeVisible()
    expect(saves).toEqual([])
  })
})

test.describe("Mods tab files", () => {
  const MOD = { filename: "apple.jar", id: "apple", name: "Apple Mod", version: "1.0", enabled: true, size: 1, modified: 0, modified_str: "", source: "local" }

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances/alpha/mods", (route) => route.fulfill({ json: [MOD] }))
    await openEdit(page)
    await page.getByRole("button", { name: "Mods", exact: true }).click()
    await expect(page.getByRole("row", { name: /Apple Mod/ })).toBeVisible()
  })

  test("Add File uploads a mod jar", async ({ page }) => {
    let upload = ""
    await page.route("**/api/instances/alpha/mods/upload", (route) => {
      upload = route.request().postData() || ""
      return route.fulfill({ json: { ok: true } })
    })
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "Add File" }).click()
    await (await chooser).setFiles({ name: "banana.jar", mimeType: "application/java-archive", buffer: Buffer.from("PK") })
    await expect(page.getByText('Mod "banana.jar" uploaded successfully!')).toBeVisible()
    expect(upload).toContain('filename="banana.jar"')
  })

  test("Export List copies the mod list", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.getByRole("button", { name: "Export List" }).click()
    await expect(page.getByText("Copied list of 1 mods to clipboard!")).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Apple Mod (1.0) [Enabled]")
  })
})
