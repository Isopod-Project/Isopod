import { test, expect } from "./fixtures"

const BACKUP = { name: "backup-20261015-120000.zip", size: 2048, created: 1760529600 }

test.describe("Instance backups tab", () => {
  test.beforeEach(async ({ page }) => {
    let backups = [BACKUP]
    await page.route("**/api/instances/*/backups", async (route) => {
      if (route.request().method() === "POST") {
        const created = { name: "backup-20261015-130000.zip", size: 4096, created: 1760533200 }
        backups = [created, ...backups]
        return route.fulfill({ json: created })
      }
      return route.fulfill({
        json: { settings: { enabled: false, interval_hours: 24, keep: 7 }, backups, worlds: ["world"] },
      })
    })
    await page.route("**/api/instances/*/backups/settings", (route) =>
      route.fulfill({ json: route.request().postDataJSON() }),
    )

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
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 24, keep: 7 })
    await expect(page.getByText("Schedule saved")).toBeVisible()

    request = savedSchedule()
    await page.getByLabel("Frequency").selectOption({ label: "Every 6 hours" })
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 6, keep: 7 })

    request = savedSchedule()
    await page.getByLabel("Backups to keep").fill("3")
    await page.getByLabel("Backups to keep").press("Enter")
    expect((await request).postDataJSON()).toEqual({ enabled: true, interval_hours: 6, keep: 3 })
  })
})
