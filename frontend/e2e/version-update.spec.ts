import { test, expect, MOCK_INSTANCES } from "./fixtures"
import type { Page } from "@playwright/test"

// Year-based ids (26.x) sort newer than 1.x in the manifest, which is ordered newest first.
const MANIFEST = {
  versions: [
    { id: "26.1", type: "release" },
    { id: "26.1-snapshot-1", type: "snapshot" },
    { id: "1.21.1", type: "release" },
  ],
}

async function mockInstanceVersion(page: Page, version: string) {
  // Status (and so the sidebar version) is only fetched for instances with a compose file.
  await page.route("**/api/instances", (route) =>
    route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
  )
  await page.route("**/api/meta/versions", (route) => route.fulfill({ json: MANIFEST }))
  await page.route("**/api/instances/*/status", (route) =>
    route.fulfill({ json: { instance_id: "alpha", is_running: false, is_ready: false, containers: [], version } }),
  )
  await page.route("**/api/instances/*/config", (route) =>
    route.fulfill({ json: { environment: { VERSION: version, TYPE: "VANILLA" } } }),
  )
  await page.route("**/api/mods/check-compatibility", (route) =>
    route.fulfill({ json: { compatible: [], incompatible: [] } }),
  )
}

test.describe("Update world to a new Minecraft version", () => {
  test("outdated instance offers an update to the latest release", async ({ page }) => {
    await mockInstanceVersion(page, "1.21.1")
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()

    await page.getByRole("button", { name: "Update to 26.1" }).click()
    await expect(page.getByText("Change Minecraft Version")).toBeVisible()
    await expect(page.getByRole("button", { name: "Change to 26.1" })).toBeVisible()
  })

  test("instance on the latest release shows no update button", async ({ page }) => {
    await mockInstanceVersion(page, "26.1")
    await page.goto("/")
    await page.getByText("Alpha Server").first().click()

    await expect(page.getByText("26.1", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Update to/ })).toHaveCount(0)
  })
})
