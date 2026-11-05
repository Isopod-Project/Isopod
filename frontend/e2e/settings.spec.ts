import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

let saved: Record<string, unknown>[]

test.beforeEach(async ({ page }) => {
  saved = []
  await page.route("**/api/settings", (route) => {
    if (route.request().method() !== "PUT") return route.fallback()
    saved.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto("/")
  await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
  await page.getByRole("button", { name: /^Settings$/ }).click()
  await expect(page.getByRole("heading", { name: "Application Settings" })).toBeVisible()
})

const tab = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).first()
const saveButton = (page: Page) => page.getByRole("button", { name: "Save Settings" })

// The switch on a settings row, found by the row's title
const switchFor = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'justify-between')][1]").getByRole("button")

async function save(page: Page) {
  await saveButton(page).click()
  await expect.poll(() => saved.length).toBe(1)
  return saved[0]
}

test("Save Settings is disabled until something changes, and the footer offers to discard", async ({ page }) => {
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.getByText("Close", { exact: true })).toBeVisible()
  await switchFor(page, "Automatic Refresh").click()
  await expect(saveButton(page)).toBeEnabled()
  await page.getByRole("button", { name: "Discard Changes" }).click()
  await expect(page.getByRole("heading", { name: "Application Settings" })).toBeHidden()

  await page.getByRole("button", { name: /^Settings$/ }).click()
  await expect(saveButton(page)).toBeDisabled()
  expect(saved).toEqual([])
})

test("General switches and the backup folder are saved", async ({ page }) => {
  await switchFor(page, "Automatic Refresh").click()
  await switchFor(page, "Show Snapshots").click()
  await page.getByLabel("Backup Folder").fill("/mnt/backups")
  expect(await save(page)).toMatchObject({ autoRefresh: true, showSnapshots: true, backupsPath: "/mnt/backups" })
})

test("the chosen language is saved", async ({ page }) => {
  await tab(page, "Language").click()
  await page.getByRole("button", { name: "German" }).click()
  expect(await save(page)).toMatchObject({ language: "German" })
})

test("a saved theme sticks after closing", async ({ page }) => {
  await tab(page, "Appearance").click()
  await page.getByRole("button", { name: /Light Mode/ }).click()
  expect(await save(page)).toMatchObject({ theme: "Light" })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("heading", { name: "Application Settings" })).toBeHidden()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
})

test("server defaults are saved, and new instances start from them", async ({ page }) => {
  let created: Record<string, unknown> | null = null
  await page.route("**/api/instances", (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    created = route.request().postDataJSON()
    return route.fulfill({ json: { id: "new", name: "New" } })
  })

  await tab(page, "Server Defaults").click()
  await page.getByRole("button", { name: "4G", exact: true }).click()
  await page.getByRole("button", { name: "FABRIC", exact: true }).click()
  await switchFor(page, "Default Whitelist").click()
  const user = page.getByPlaceholder("Add username...")
  await user.fill("Alex")
  await user.press("Enter")
  await expect(page.getByText("Default Whitelisted Players (1)")).toBeVisible()
  expect(await save(page)).toMatchObject({
    defaultMemory: "4G",
    defaultLoader: "FABRIC",
    defaultWhitelistEnabled: true,
    defaultWhitelistUsers: ["Alex"],
  })

  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /Add Instance/ }).click()
  await page.getByPlaceholder("e.g. My Modded World").fill("New")
  await page.getByRole("button", { name: /Next/ }).click()
  await page.getByRole("button", { name: "Create Instance" }).click()
  await expect.poll(() => created).toMatchObject({
    template: "fabric",
    memory: "4G",
    whitelist_enabled: true,
    whitelist_users: ["Alex"],
  })
})

test("Updates shows the commands when Isopod can't update itself", async ({ page }) => {
  await page.route("**/api/system/check-updates*", (route) =>
    route.fulfill({ json: { current_version: "0.3.0", latest_version: "0.4.0", has_update: true, release_notes: "Faster", can_self_update: false } }),
  )
  await tab(page, "Updates").click()
  await expect(page.getByText("docker compose -f isopod-compose.yml up -d --build")).toBeVisible()
  await expect(page.getByRole("button", { name: "Update Now" })).toHaveCount(0)
})

test("Updates offers Update Now when Isopod can update itself", async ({ page }) => {
  await page.route("**/api/system/check-updates*", (route) =>
    route.fulfill({ json: { current_version: "0.3.0", latest_version: "0.4.0", has_update: true, release_notes: "Faster", can_self_update: true } }),
  )
  await tab(page, "Updates").click()
  await expect(page.getByRole("button", { name: "Update Now" })).toBeVisible()
})

test("Updates checks for a new version and shows it", async ({ page }) => {
  await page.route("**/api/system/check-updates*", (route) =>
    route.fulfill({ json: { current_version: "0.3.0", latest_version: "0.4.0", has_update: true, release_notes: "Faster" } }),
  )
  await tab(page, "Updates").click()
  await expect(page.getByText("0.4.0").first()).toBeVisible()
})

test("Advanced downloads the application logs", async ({ page }) => {
  await page.route("**/api/system/logs/export", (route) =>
    route.fulfill({ body: "log", headers: { "Content-Disposition": 'attachment; filename="isopod.log"' } }),
  )
  await tab(page, "Advanced").click()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: /Export.*Logs/i }).click()
  expect((await download).url()).toContain("/api/system/logs/export")
})
