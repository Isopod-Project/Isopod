import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

const VERSIONS = [
  { id: "1.21.1", type: "release", releaseTime: "2024-08-08T00:00:00Z" },
  { id: "1.20.4", type: "release", releaseTime: "2023-12-07T00:00:00Z" },
  { id: "24w01a", type: "snapshot", releaseTime: "2024-01-03T00:00:00Z" },
  { id: "b1.7.3", type: "old_beta", releaseTime: "2011-07-08T00:00:00Z" },
  { id: "a1.2.6", type: "old_alpha", releaseTime: "2010-12-03T00:00:00Z" },
]

const FABRIC_LOADERS = [
  { id: "0.16.5", stable: true },
  { id: "0.16.4", stable: true },
]

const PACK = { id: "fabulously", name: "Fabulously Optimized", author: "robotkoer", summary: "Fast", downloads: 5000 }
const PACK_VERSIONS = [
  { id: "v2", name: "6.1.0", version_type: "beta", game_versions: ["1.21.1"] },
  { id: "v1", name: "6.0.0", version_type: "release", game_versions: ["1.21"] },
]

let created: Record<string, unknown>[]

async function openAdd(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
  await page.getByRole("button", { name: /Add Instance/ }).click()
  await expect(page.getByText("Server Type")).toBeVisible()
}

async function nextAndCreate(page: Page, name = "New Server") {
  await page.getByPlaceholder("e.g. My Modded World").fill(name)
  await page.getByRole("button", { name: /Next/ }).click()
  await page.getByRole("button", { name: "Create Instance" }).click()
  await expect.poll(() => created.length).toBe(1)
  return created[0]
}

// The version table lists one row per version id
const versionRow = (page: Page, id: string) => page.getByText(id, { exact: true })

test.beforeEach(async ({ page }) => {
  created = []
  await page.route("**/api/meta/versions", (route) => route.fulfill({ json: { versions: VERSIONS } }))
  await page.route(/\/api\/meta\/loaders\/fabric/i, (route) => route.fulfill({ json: FABRIC_LOADERS }))
  await page.route("**/api/instances", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    created.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: "new-server", name: "New Server" } })
  })
})

test.describe("Custom instance: versions", () => {
  test.beforeEach(async ({ page }) => openAdd(page))

  test("shows releases by default and filters by category", async ({ page }) => {
    await expect(versionRow(page, "1.21.1")).toBeVisible()
    await expect(versionRow(page, "24w01a")).toHaveCount(0)
    await expect(versionRow(page, "b1.7.3")).toHaveCount(0)

    await page.getByLabel("Snapshots").check()
    await expect(versionRow(page, "24w01a")).toBeVisible()
    await page.getByLabel("Betas").check()
    await expect(versionRow(page, "b1.7.3")).toBeVisible()
    await page.getByLabel("Alphas").check()
    await expect(versionRow(page, "a1.2.6")).toBeVisible()

    await page.getByLabel("Releases").uncheck()
    await expect(versionRow(page, "1.21.1")).toHaveCount(0)
  })

  test("search narrows the list and says when nothing matches", async ({ page }) => {
    await page.getByPlaceholder("Search...").fill("1.20")
    await expect(versionRow(page, "1.20.4")).toBeVisible()
    await expect(versionRow(page, "1.21.1")).toHaveCount(0)
    await page.getByPlaceholder("Search...").fill("nope")
    await expect(page.getByText("No versions match your filters")).toBeVisible()
  })

  test("the chosen version is sent on create", async ({ page }) => {
    await versionRow(page, "1.20.4").click()
    expect(await nextAndCreate(page)).toMatchObject({ version: "1.20.4", template: "vanilla" })
  })
})

test.describe("Custom instance: loaders", () => {
  test.beforeEach(async ({ page }) => openAdd(page))

  for (const loader of ["FABRIC", "FORGE", "NEOFORGE", "QUILT", "PAPER"]) {
    test(`${loader} is sent as the template`, async ({ page }) => {
      await page.getByRole("button", { name: loader, exact: true }).click()
      expect(await nextAndCreate(page)).toMatchObject({ template: loader.toLowerCase() })
    })
  }

  test("a loader lists its versions, defaulting to the latest", async ({ page }) => {
    await page.getByRole("button", { name: "FABRIC", exact: true }).click()
    await expect(page.getByText("Latest Recommended")).toBeVisible()
    await expect(page.getByText("0.16.4", { exact: true })).toBeVisible()
    expect(await nextAndCreate(page)).toMatchObject({ template: "fabric", loader_version: "latest" })
  })

  test("a specific loader version can be pinned", async ({ page }) => {
    await page.getByRole("button", { name: "FABRIC", exact: true }).click()
    await page.getByText("0.16.4", { exact: true }).click()
    expect(await nextAndCreate(page)).toMatchObject({ loader_version: "0.16.4" })
  })

  test("Vanilla shows no loader versions", async ({ page }) => {
    await page.getByRole("button", { name: "FABRIC", exact: true }).click()
    await expect(page.getByText("Latest Recommended")).toBeVisible()
    await page.getByRole("button", { name: "VANILLA", exact: true }).click()
    await expect(page.getByText("Latest Recommended")).toHaveCount(0)
  })
})

test.describe("Custom instance: world settings", () => {
  test.beforeEach(async ({ page }) => {
    await openAdd(page)
    await page.getByPlaceholder("e.g. My Modded World").fill("New Server")
    await page.getByRole("button", { name: /Next/ }).click()
    await expect(page.getByText("World configuration")).toBeVisible()
  })

  const selectWith = (page: Page, value: string) => page.locator("select").filter({ has: page.locator(`option[value="${value}"]`) })

  test("Next needs a name", async ({ page }) => {
    await page.getByRole("button", { name: "Back" }).click()
    await page.getByPlaceholder("e.g. My Modded World").fill("")
    await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled()
  })

  test("Back returns to the server type and keeps the name", async ({ page }) => {
    await page.getByRole("button", { name: "Back" }).click()
    await expect(page.getByRole("heading", { name: "Mod Loader" })).toBeVisible()
    await expect(page.getByPlaceholder("e.g. My Modded World")).toHaveValue("New Server")
  })

  test("seed, level type, difficulty, game mode and structures are sent on create", async ({ page }) => {
    await page.getByPlaceholder("Leave empty for random seed...").fill("isopod")
    await selectWith(page, "FLAT").selectOption("FLAT")
    await selectWith(page, "hard").selectOption("hard")
    await selectWith(page, "creative").selectOption("creative")
    const structures = page.getByRole("button", { name: "Enabled" })
    await structures.click()
    await expect(page.getByRole("button", { name: "Disabled" })).toBeVisible()

    await page.getByRole("button", { name: "Create Instance" }).click()
    await expect.poll(() => created.length).toBe(1)
    expect(created[0]).toMatchObject({
      name: "New Server",
      seed: "isopod",
      level_type: "FLAT",
      difficulty: "hard",
      gamemode: "creative",
      generate_structures: false,
    })
  })

  test("whitelist players can be added, removed and sent with the whitelist on", async ({ page }) => {
    const draft = page.getByPlaceholder("Enter Minecraft username...")
    await draft.fill("Alex")
    await draft.press("Enter")
    await draft.fill("Steve")
    await page.getByRole("button", { name: "Add Player" }).click()
    // Duplicates are ignored
    await draft.fill("Alex")
    await draft.press("Enter")
    await expect(page.getByText("Allowed Players (2)")).toBeVisible()

    await page.getByText("Steve", { exact: true }).locator("..").getByRole("button").click()
    await expect(page.getByText("Allowed Players (1)")).toBeVisible()

    await expect(page.getByText("Whitelist inactive (players saved to server roster)")).toBeVisible()
    await page.getByText("Server Whitelist").locator("xpath=ancestor::div[contains(@class,'justify-between')][1]").getByRole("button").click()
    await expect(page.getByText("Whitelist active")).toBeVisible()

    await page.getByRole("button", { name: "Create Instance" }).click()
    await expect.poll(() => created.length).toBe(1)
    expect(created[0]).toMatchObject({ whitelist_enabled: true, whitelist_users: ["Alex"] })
  })
})

test.describe("Modrinth modpacks", () => {
  let searches: URL[]

  test.beforeEach(async ({ page }) => {
    searches = []
    await page.route("**/api/mods/search/modrinth?**", (route) => {
      searches.push(new URL(route.request().url()))
      return route.fulfill({ json: [PACK] })
    })
    await page.route("**/api/mods/modrinth/fabulously/versions", (route) => route.fulfill({ json: PACK_VERSIONS }))
    await openAdd(page)
    await page.getByRole("button", { name: "Modrinth", exact: true }).click()
  })

  test("searches as you open the tab and on Search, with the server-side filter", async ({ page }) => {
    await expect(page.getByText("Fabulously Optimized")).toBeVisible()
    await page.getByPlaceholder("Search modrinth modpacks...").fill("fabric")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expect.poll(() => searches.at(-1)?.searchParams.get("q")).toBe("fabric")
    expect(searches.at(-1)?.searchParams.get("only_server_side")).toBe("true")

    await page.getByLabel(/server-side/i).uncheck()
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expect.poll(() => searches.at(-1)?.searchParams.get("only_server_side")).toBe("false")
  })

  test("Next stays disabled until a pack is chosen", async ({ page }) => {
    await page.getByPlaceholder("e.g. My Modded World").fill("Pack Server")
    await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled()
  })

  test("choosing a pack fills the name, picks the latest release and creates from the chosen version", async ({ page }) => {
    await page.getByText("Fabulously Optimized").click()
    await expect(page.getByPlaceholder("e.g. My Modded World")).toHaveValue("Fabulously Optimized")
    const version = page.locator("select").filter({ has: page.locator('option[value="v1"]') })
    await expect(version).toHaveValue("v1")
    await version.selectOption("v2")

    await page.getByRole("button", { name: /Next/ }).click()
    await page.getByRole("button", { name: "Create Instance" }).click()
    await expect.poll(() => created.length).toBe(1)
    expect(created[0]).toMatchObject({ name: "Fabulously Optimized", modrinth_id: "fabulously", modpack_version: "v2" })
  })
})

test.describe("Import archive", () => {
  test("Clear removes the chosen file and disables Next", async ({ page }) => {
    await openAdd(page)
    await page.getByRole("button", { name: "Import", exact: true }).click()
    await page.getByPlaceholder("e.g. My Modded World").fill("Imported")
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({ name: "world.zip", mimeType: "application/zip", buffer: Buffer.from("PK") })
    await expect(page.getByText("world.zip")).toBeVisible()
    await expect(page.getByRole("button", { name: /Next/ })).toBeEnabled()
    await page.getByRole("button", { name: "Clear" }).click()
    await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled()
  })
})
