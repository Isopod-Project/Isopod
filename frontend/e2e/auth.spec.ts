import { test, expect } from "./fixtures"

// Dashboard login (#143). The backend is mocked, so these tests check the dashboard's side:
// which screen it shows for each /api/auth/status answer, and what it sends.

const LOGGED_OUT = { setup_required: false, authenticated: false, username: null }
const LOGGED_IN = { setup_required: false, authenticated: true, username: "admin" }

// 401s are logged by the browser as failed resources; these tests cause them on purpose.
const UNAUTHORIZED = /status of 401/

test.describe("Login", () => {
  test("first run asks for an admin account and opens the dashboard", async ({ page }) => {
    let status = { setup_required: true, authenticated: false, username: null as string | null }
    let sent: unknown = null
    await page.route("**/api/auth/status", (route) => route.fulfill({ json: status }))
    await page.route("**/api/auth/setup", async (route) => {
      sent = route.request().postDataJSON()
      status = LOGGED_IN
      await route.fulfill({ json: { username: "admin" } })
    })

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Set up Isopod" })).toBeVisible()
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("correct horse")
    await page.getByLabel("Confirm password").fill("different")
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByText("Passwords don't match.")).toBeVisible()
    expect(sent).toBeNull()

    await page.getByLabel("Confirm password").fill("correct horse")
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
    expect(sent).toEqual({ username: "admin", password: "correct horse" })
  })

  test("logs in, shows a wrong password, and logs out", async ({ page, errors }) => {
    errors.expect(UNAUTHORIZED)
    let status: typeof LOGGED_OUT | typeof LOGGED_IN = LOGGED_OUT
    await page.route("**/api/auth/status", (route) => route.fulfill({ json: status }))
    await page.route("**/api/auth/login", async (route) => {
      const { password } = route.request().postDataJSON()
      if (password !== "correct horse") return route.fulfill({ status: 401, json: { detail: "Wrong username or password." } })
      status = LOGGED_IN
      await route.fulfill({ json: { username: "admin" } })
    })
    let loggedOut = false
    await page.route("**/api/auth/logout", async (route) => {
      loggedOut = true
      status = LOGGED_OUT
      await route.fulfill({ json: { ok: true } })
    })

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Log in to Isopod" })).toBeVisible()
    await expect(page.getByText("Alpha Server")).toHaveCount(0)

    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password").fill("wrong")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.getByText("Wrong username or password.")).toBeVisible()

    await page.getByLabel("Password").fill("correct horse")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()

    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Account" }).click()
    await expect(page.getByText("Logged in as admin")).toBeVisible()
    await page.getByRole("button", { name: "Log out" }).click()
    await expect(page.getByRole("heading", { name: "Log in to Isopod" })).toBeVisible()
    expect(loggedOut).toBe(true)
  })

  test("an API call rejected as unauthenticated returns to the login screen", async ({ page, errors }) => {
    errors.expect(UNAUTHORIZED)
    await page.goto("/")
    await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()

    // The session expires or is revoked: the backend starts answering 401
    await page.route("**/api/instances", (route) => route.fulfill({ status: 401, json: { detail: "Not logged in." } }))
    await page.evaluate(() => fetch("/api/instances"))
    await expect(page.getByRole("heading", { name: "Log in to Isopod" })).toBeVisible()
  })
})
