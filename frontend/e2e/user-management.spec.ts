import { test, expect } from "./fixtures"

test.describe("User Management autocomplete", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances/alpha/users", (route) =>
      route.fulfill({ json: [{ name: "Alex", uuid: "", level: 0, is_op: false, whitelisted: true, active: true }] }),
    )
    await page.route("**/api/instances/alpha/config", (route) =>
      route.fulfill({ json: { environment: { ENABLE_WHITELIST: "false" }, ports: [], volumes: [] } }),
    )
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "User Management", exact: true }).click()
  })

  test("suggests players that belong to the install", async ({ page }) => {
    await page.getByPlaceholder("Minecraft Gamertag...").fill("Al")
    await expect(page.getByText("Suggested Gamertags (1)")).toBeVisible()
  })

  test("a fresh install suggests no unknown players", async ({ page }) => {
    for (const name of ["Dream", "Grian", "Technoblade"]) {
      await page.getByPlaceholder("Minecraft Gamertag...").fill(name)
      await expect(page.getByText(/Suggested Gamertags/)).toHaveCount(0)
    }
  })
})
