import { test, expect } from "./fixtures"

const BACKUP = { name: "backup-20261015-120000.zip", size: 2048, created: 1760529600 }
const SNAPSHOT = {
  name: "snapshot-20261016-090000.zip",
  size: 8192,
  created: 1760605200,
  reason: "Before changing Fabric loader version, mods",
}

test.describe("Instance backups tab", () => {
  test.beforeEach(async ({ page }) => {
    let backups = [BACKUP]
    let settings = { enabled: false, interval_hours: 24, keep: 7, snapshot_keep: 3 }
    await page.route("**/api/instances/*/backups", async (route) => {
      if (route.request().method() === "POST") {
        const created = { name: "backup-20261015-130000.zip", size: 4096, created: 1760533200 }
        backups = [created, ...backups]
        return route.fulfill({ json: created })
      }
      return route.fulfill({
        json: {
          settings,
          backups,
          snapshots: [SNAPSHOT],
          worlds: ["world"],
        },
      })
    })
    await page.route("**/api/instances/*/backups/settings", (route) => {
      settings = route.request().postDataJSON()
      return route.fulfill({ json: settings })
    })

    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Backups", exact: true }).click()
  })

  test("lists existing backups and creates a new one", async ({ page }) => {
    await expect(page.getByText("World Backups")).toBeVisible()
    await expect(page.getByText(/backup-20261015-120000\.zip/)).toBeVisible()

    await page.getByRole("button", { name: "Back Up Now" }).click()
    await expect(page.getByText(/backup-20261015-130000\.zip/)).toBeVisible()
  })

  test("saves each schedule change immediately", async ({ page }) => {
    const savedSchedule = () => page.waitForRequest((req) => req.url().endsWith("/backups/settings") && req.method() === "PUT")

    let request = savedSchedule()
    await page.getByLabel("Automatic backups").check()
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 24, keep: 7, snapshot_keep: 3 })
    await expect(page.getByText("Schedule saved")).toBeVisible()

    request = savedSchedule()
    await page.getByLabel("Frequency").selectOption({ label: "Every 6 hours" })
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 6, keep: 7, snapshot_keep: 3 })

    request = savedSchedule()
    await page.getByLabel("Backups to keep").fill("3")
    await page.getByLabel("Backups to keep").press("Enter")
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 6, keep: 3, snapshot_keep: 3 })
  })

  test("lists pre-update snapshots with their reason and saves how many to keep", async ({ page }) => {
    await expect(page.getByText("Pre-update snapshots")).toBeVisible()
    await expect(page.getByText(SNAPSHOT.reason)).toBeVisible()
    await expect(page.getByText(/snapshot-20261016-090000\.zip/)).toBeVisible()
    // Snapshots stay out of the regular backup list
    await expect(page.getByText(/backup-20261015-120000\.zip/)).toBeVisible()

    const request = page.waitForRequest((req) => req.url().endsWith("/backups/settings") && req.method() === "PUT")
    await page.getByLabel("Snapshots to keep").fill("0")
    await page.getByLabel("Snapshots to keep").press("Enter")
    expect((await request).postDataJSON()).toEqual({ enabled: false, interval_hours: 24, keep: 7, snapshot_keep: 0 })
    await expect(page.getByText("Snapshots are off.", { exact: false })).toBeVisible()
  })
})
