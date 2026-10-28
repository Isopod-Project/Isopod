import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

const SAVED_CONFIG = {
  image: "itzg/minecraft-server",
  environment: { VERSION: "1.21.1", TYPE: "FABRIC", MOTD: "Hi", MODRINTH_PROJECTS: "applemod" },
}

const APPLE = {
  filename: "applemod.jar",
  id: "applemod",
  name: "Apple Mod",
  version: "1.0",
  enabled: true,
  size: 1024,
  modified: 0,
  modified_str: "2026-10-01",
  source: "local",
  provider: "modrinth",
}

const SODIUM = {
  id: "sodium",
  name: "Sodium",
  summary: "Rendering engine",
  author: "jellysquid",
  downloads: 1000,
  categories: ["fabric"],
  latest_version: "0.6.0",
}

let configPuts: { environment: Record<string, string> }[]

async function openEdit(page: Page) {
  await page.goto("/")
  await page.getByText("Alpha Server").first().click()
  await page.getByRole("button", { name: "Edit" }).first().click()
}

const closeButton = (page: Page) => page.getByTitle("Close", { exact: true })
const editHeading = (page: Page) => page.getByRole("button", { name: "Configuration" })

test.describe("Edit window saving", () => {
  test.beforeEach(async ({ page }) => {
    configPuts = []
    let mods = [APPLE]
    await page.route("**/api/instances/*/config", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON()
        configPuts.push(body)
        if (body.environment.MODRINTH_PROJECTS?.includes("sodium")) {
          mods = [{ ...APPLE, filename: "sodium.jar", id: "sodium", name: "Sodium" }, ...mods]
        }
        return route.fulfill({ json: { message: "Config updated", snapshot: null, downloaded: ["sodium"], failed: [] } })
      }
      return route.fulfill({ json: SAVED_CONFIG })
    })
    await page.route("**/api/instances/*/mods", (route) => route.fulfill({ json: mods }))
    await page.route("**/api/instances/*/mods/toggle", (route) => {
      mods = mods.map((m) => ({ ...m, enabled: false, filename: `${m.filename}.disabled` }))
      return route.fulfill({ json: { ok: true } })
    })
    await page.route("**/api/mods/search/**", (route) => route.fulfill({ json: [SODIUM] }))
  })

  test("closing with a staged change asks before discarding it", async ({ page }) => {
    await openEdit(page)
    await page.getByRole("button", { name: "Configuration" }).click()
    await page.getByLabel("Value of MOTD").fill("Changed")
    await expect(page.getByText("Unsaved Changes")).toBeVisible()

    await closeButton(page).click()
    await expect(page.getByText("Discard 1 unsaved change?")).toBeVisible()
    await page.getByRole("button", { name: "Keep editing" }).click()
    await expect(page.getByLabel("Value of MOTD")).toHaveValue("Changed")

    await closeButton(page).click()
    await page.getByRole("button", { name: "Discard" }).click()
    await expect(editHeading(page)).toHaveCount(0)
    expect(configPuts).toEqual([])
  })

  test("adding a mod from search installs it right away, leaving other edits unsaved", async ({ page }) => {
    await openEdit(page)
    await page.getByRole("button", { name: "Configuration" }).click()
    await page.getByLabel("Value of MOTD").fill("Changed")

    await page.getByRole("button", { name: "Mods", exact: true }).click()
    await page.getByRole("button", { name: "Download Mods" }).click()
    await page.getByPlaceholder("Search for mods...").fill("sodium")
    await page.getByRole("button", { name: "Add", exact: true }).click()

    await expect.poll(() => configPuts.length).toBe(1)
    expect(configPuts[0].environment.MODRINTH_PROJECTS).toBe("applemod,sodium")
    // The staged MOTD edit is not saved along with the mod
    expect(configPuts[0].environment.MOTD).toBe("Hi")
    await expect(page.getByText("Added", { exact: true })).toBeVisible()

    // Only the MOTD edit is still unsaved
    await closeButton(page).click()
    await expect(page.getByText("Discard 1 unsaved change?")).toBeVisible()
  })

  test("toggling an installed mod applies at once and leaves nothing unsaved", async ({ page }) => {
    await openEdit(page)
    await page.getByRole("button", { name: "Mods", exact: true }).click()
    await expect(page.getByText("Changes here apply right away")).toBeVisible()
    await page.getByRole("row", { name: /Apple Mod/ }).dblclick()
    await expect(page.getByRole("row", { name: /Apple Mod/ }).getByRole("checkbox")).not.toBeChecked()

    await expect(page.getByText("Unsaved Changes")).toHaveCount(0)
    await closeButton(page).click()
    await expect(editHeading(page)).toHaveCount(0)
  })

  test("the whitelist switch is saved with User Management, not the main Save", async ({ page }) => {
    let savedUsers: { whitelist_enabled?: boolean } | null = null
    await page.route("**/api/instances/*/users", (route) => {
      if (route.request().method() === "PUT") {
        savedUsers = route.request().postDataJSON()
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ json: { users: [] }, headers: { "X-Whitelist-Enabled": "false" } })
    })

    await openEdit(page)
    await page.getByRole("button", { name: "User Management" }).click()
    await page.getByRole("button", { name: "Toggle Whitelist" }).click()
    await expect(page.getByText("Unsaved Changes")).toHaveCount(0)

    await closeButton(page).click()
    await expect(page.getByText("Discard 1 unsaved change?")).toBeVisible()
    await page.getByRole("button", { name: "Keep editing" }).click()

    await page.getByRole("button", { name: "Save User Configuration" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    expect(savedUsers).toMatchObject({ whitelist_enabled: true })
    await expect(page.getByText("Unsaved Changes")).toHaveCount(0)

    await closeButton(page).click()
    await expect(editHeading(page)).toHaveCount(0)
  })
})
