import { test, expect, MOCK_INSTANCES } from "./fixtures"
import type { Page } from "@playwright/test"

const version = (id: string, number: string, mc: string, date: string, type = "release") => ({
  id,
  name: `Pack ${number}`,
  version_number: number,
  version_type: type,
  minecraft_version: mc,
  loaders: ["fabric"],
  date_published: date,
  changelog: `Changes in ${number}`,
})

const OLD = version("old1", "1.0.0", "1.20.1", "2026-01-01T00:00:00Z")
const NEW = version("new2", "2.0.0", "1.21.1", "2026-03-01T00:00:00Z")
const OLDER = version("older0", "0.9.0", "1.20.1", "2025-12-01T00:00:00Z")

const STATUS = {
  project: { title: "My Pack", summary: "A great pack", icon_url: null, url: "https://modrinth.com/modpack/my-pack" },
  current: OLD,
  latest: NEW,
  update_available: true,
  versions: [NEW, OLD, OLDER],
}

const MODPACK_ENV = { TYPE: "MODRINTH", VERSION: "1.20.1", MODRINTH_MODPACK: "my-pack", MODRINTH_VERSION: "old1" }

const RESULT = {
  version_number: "2.0.0",
  image: "itzg/minecraft-server:java21",
  environment: { MODRINTH_VERSION: "new2", VERSION: "1.21.1" },
  snapshot: null,
  restarted: false,
  restart_error: null,
}

let updates: { version_id: string; backup: boolean; restart: boolean }[]

async function routeInstance(page: Page, { running = false, env = MODPACK_ENV as Record<string, string>, update = true } = {}) {
  updates = []
  await page.route("**/api/instances", (route) =>
    route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
  )
  await page.route("**/api/instances/alpha/status", (route) => route.fulfill({
    json: {
      instance_id: "alpha", is_running: running, is_ready: running, containers: [],
      modpack_update: update ? { current: "1.0.0", latest: "2.0.0" } : null,
    },
  }))
  await page.route("**/api/instances/alpha/config", (route) => route.fulfill({
    json: { image: "itzg/minecraft-server:java17", environment: env },
  }))
  await page.route("**/api/instances/alpha/modpack/status*", (route) => route.fulfill({ json: STATUS }))
  await page.route("**/api/instances/alpha/modpack/update", (route) => {
    updates.push(route.request().postDataJSON())
    return route.fulfill({ json: RESULT })
  })
}

async function openModpackTab(page: Page) {
  await page.goto("/")
  await page.getByRole("main").getByText("Alpha Server").click()
  await page.locator("aside").getByRole("button", { name: "View Update" }).click()
  await expect(page.getByRole("heading", { name: "My Pack" })).toBeVisible()
}

const confirmDialog = (page: Page) => page.getByRole("dialog", { name: "Confirm modpack update" })

test.describe("Modpack updates", () => {
  test("the tile and side panel say an update is available", async ({ page }) => {
    await routeInstance(page)
    await page.goto("/")
    const main = page.getByRole("main")
    await expect(main.getByText("Update Available")).toBeVisible()
    await main.getByText("Alpha Server").click()
    await expect(page.locator("aside").getByRole("region", { name: "Modpack update" })).toContainText("2.0.0")
  })

  test("no badge when the modpack is current", async ({ page }) => {
    await routeInstance(page, { update: false })
    await page.goto("/")
    const main = page.getByRole("main")
    await main.getByText("Alpha Server").click()
    await expect(page.locator("aside").getByRole("button", { name: "Edit" })).toBeVisible()
    await expect(main.getByText("Update Available")).toHaveCount(0)
    await expect(page.locator("aside").getByRole("region", { name: "Modpack update" })).toHaveCount(0)
  })

  test("the Modpack tab only appears on modpack instances", async ({ page }) => {
    await routeInstance(page, { env: { TYPE: "FABRIC", VERSION: "1.21.1" }, update: false })
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.locator("aside").getByRole("button", { name: "Edit" }).click()
    await expect(page.getByRole("button", { name: "Configuration" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Modpack", exact: true })).toHaveCount(0)
  })

  test("the tab shows the pack, its current version and the update", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await expect(page.getByRole("button", { name: "Modpack", exact: true })).toBeVisible()
    await expect(page.getByText("A great pack")).toBeVisible()
    await expect(page.getByRole("link", { name: "View on Modrinth" })).toHaveAttribute("href", STATUS.project.url)
    const banner = page.getByRole("region", { name: "Update available" })
    await expect(banner).toContainText("2.0.0")
    await expect(banner).toContainText("New Minecraft version: 1.20.1 to 1.21.1")
    await expect(banner).toContainText("Changes in 2.0.0")
  })

  test("changelogs open from the version list", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await expect(page.getByText("Changes in 0.9.0")).toHaveCount(0)
    await page.getByRole("button", { name: "Changelog for 0.9.0" }).click()
    await expect(page.getByText("Changes in 0.9.0")).toBeVisible()
  })

  test("Update to Latest backs up by default and warns about the Minecraft change", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    const dialog = confirmDialog(page)
    await expect(dialog).toContainText("This changes Minecraft from 1.20.1 to 1.21.1")
    await expect(dialog.getByLabel("Create backup before updating")).toBeChecked()
    // The server isn't running, so there's nothing to restart
    await expect(dialog.getByLabel("Restart the server now")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Update" }).click()
    await expect(page.getByText("It installs the next time the server starts.")).toBeVisible()
    expect(updates).toEqual([{ version_id: "new2", backup: true, restart: false }])
  })

  test("a running server offers a restart, and the backup can be turned off", async ({ page }) => {
    await routeInstance(page, { running: true })
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    const dialog = confirmDialog(page)
    await expect(dialog.getByLabel("Restart the server now")).toBeChecked()
    await dialog.getByLabel("Create backup before updating").uncheck()
    await dialog.getByRole("button", { name: "Update" }).click()
    await expect.poll(() => updates).toEqual([{ version_id: "new2", backup: false, restart: true }])
  })

  test("any version can be picked, and an older one is called out", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await page.getByRole("button", { name: "Switch to 0.9.0" }).click()
    const dialog = confirmDialog(page)
    await expect(dialog.getByRole("heading", { name: "Switch to an older version?" })).toBeVisible()
    await dialog.getByRole("button", { name: "Switch Version" }).click()
    await expect.poll(() => updates.map((u) => u.version_id)).toEqual(["older0"])
  })

  test("Cancel leaves the modpack alone", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    await confirmDialog(page).getByRole("button", { name: "Cancel" }).click()
    await expect(confirmDialog(page)).toHaveCount(0)
    expect(updates).toEqual([])
  })

  test("the update doesn't count as an unsaved change", async ({ page }) => {
    await routeInstance(page)
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    await confirmDialog(page).getByRole("button", { name: "Update" }).click()
    await expect(page.getByText("It installs the next time the server starts.")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText("Unsaved Changes")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled()
  })

  test("a failed update shows why", async ({ page, errors }) => {
    errors.expect(/Failed to load resource/)
    await routeInstance(page)
    await page.route("**/api/instances/alpha/modpack/update", (route) =>
      route.fulfill({ status: 502, json: { detail: "Couldn't download 2.0.0 from Modrinth" } }))
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    await confirmDialog(page).getByRole("button", { name: "Update" }).click()
    await expect(page.getByText("Couldn't download 2.0.0 from Modrinth")).toBeVisible()
  })

  test("a failed restart is reported with the update kept", async ({ page }) => {
    await routeInstance(page, { running: true })
    await page.route("**/api/instances/alpha/modpack/update", (route) =>
      route.fulfill({ json: { ...RESULT, restart_error: "port in use" } }))
    await openModpackTab(page)
    await page.getByRole("button", { name: "Update to Latest" }).click()
    await confirmDialog(page).getByRole("button", { name: "Update" }).click()
    await expect(page.getByText("The modpack is set to 2.0.0, but the server didn't restart: port in use")).toBeVisible()
  })

  test("when Modrinth can't be reached the tab says so and can retry", async ({ page, errors }) => {
    errors.expect(/Failed to load resource/)
    await routeInstance(page)
    let online = false
    await page.route("**/api/instances/alpha/modpack/status*", (route) =>
      online ? route.fulfill({ json: STATUS }) : route.fulfill({ status: 502, json: { detail: "Couldn't reach Modrinth" } }),
    )
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.locator("aside").getByRole("button", { name: "View Update" }).click()
    await expect(page.getByText("Couldn't reach Modrinth")).toBeVisible()
    online = true
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(page.getByRole("heading", { name: "My Pack" })).toBeVisible()
  })
})
