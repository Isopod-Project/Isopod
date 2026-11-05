import { test, expect, MOCK_INSTANCES } from "./fixtures"
import type { Page, Route } from "@playwright/test"

// Records POSTs to an instance action endpoint (start, stop, kill, rename...) and answers ok.
function recordPosts(page: Page, pattern: string) {
  const bodies: unknown[] = []
  page.route(pattern, (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback()
    bodies.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: "alpha" } })
  })
  return bodies
}

async function openDashboard(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main").getByText("Alpha Server")).toBeVisible()
}

const sidebar = (page: Page) => page.locator("aside")

test.describe("Sidebar actions on a stopped server", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page)
    await page.getByRole("main").getByText("Alpha Server").click()
  })

  test("Start starts the server and shows it starting", async ({ page }) => {
    const starts = recordPosts(page, "**/api/instances/alpha/start")
    await sidebar(page).getByRole("button", { name: "Start" }).click()
    await expect.poll(() => starts.length).toBe(1)
    await expect(sidebar(page).getByText("Starting...").first()).toBeVisible()
  })

  test("a failed start explains why", async ({ page, errors }) => {
    errors.expect(/Failed to load resource/, /Port 25565 is taken/)
    await page.route("**/api/instances/alpha/start", (route) =>
      route.fulfill({ status: 409, json: { detail: "Port 25565 is taken" } }),
    )
    await sidebar(page).getByRole("button", { name: "Start" }).click()
    await expect(page.getByText("Start Error: Port 25565 is taken")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
  })

  test("Edit opens the Edit window on the Minecraft Log tab", async ({ page }) => {
    await sidebar(page).getByRole("button", { name: "Edit" }).click()
    await expect(page.getByRole("heading", { name: "Editing: Alpha Server" })).toBeVisible()
    await expect(page.getByPlaceholder("Type a command (whitelist, op, kick...)")).toBeVisible()
  })

  test("Folder opens the Edit window on the Files tab", async ({ page }) => {
    await sidebar(page).getByRole("button", { name: "Folder" }).click()
    await expect(page.getByTitle("New Folder")).toBeVisible()
  })

  test("Delete asks first, and Cancel keeps the instance", async ({ page }) => {
    let deletes = 0
    await page.route("**/api/instances/alpha", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback()
      deletes++
      return route.fulfill({ json: {} })
    })
    await sidebar(page).getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("permanently delete this instance")).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    expect(deletes).toBe(0)

    await sidebar(page).getByRole("button", { name: "Delete" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => deletes).toBe(1)
    await expect(page.getByText("Select an instance to view actions and details.")).toBeVisible()
  })

  test("Export lets you choose what to include and downloads the archive", async ({ page }) => {
    let exportUrl = ""
    await page.route(/\/api\/instances\/alpha\/export\?/, (route) => {
      exportUrl = route.request().url()
      return route.fulfill({ body: "PK", headers: { "Content-Disposition": 'attachment; filename="alpha.zip"' } })
    })
    await sidebar(page).getByRole("button", { name: "Export" }).click()
    await expect(page.getByText("Export Instance")).toBeVisible()
    await page.getByText("Mods", { exact: true }).click()
    await page.getByText("Server Logs", { exact: true }).click()
    await page.getByRole("button", { name: "Export" }).last().click()

    await expect.poll(() => exportUrl).not.toBe("")
    const params = new URL(exportUrl).searchParams
    expect(Object.fromEntries(params)).toEqual({ world: "true", mods: "false", configs: "true", plugins: "true", logs: "true" })
  })

  test("Export Cancel closes without downloading", async ({ page }) => {
    await sidebar(page).getByRole("button", { name: "Export" }).click()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByText("Export Instance")).toBeHidden()
  })

  test("clicking the icon asks for an image and uploads it", async ({ page }) => {
    let uploaded = false
    await page.route("**/api/instances/alpha/icon", (route) => {
      uploaded = true
      return route.fulfill({ json: {} })
    })
    const chooser = page.waitForEvent("filechooser")
    await sidebar(page).getByTitle("Click to change icon").click()
    await (await chooser).setFiles({ name: "icon.png", mimeType: "image/png", buffer: Buffer.from("png") })
    await expect.poll(() => uploaded).toBe(true)
  })
})

test.describe("Sidebar actions on a running server", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: true, is_ready: true, containers: [] } }),
    )
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await openDashboard(page)
    await page.getByRole("main").getByText("Alpha Server").click()
  })

  test("Stop sends a safe stop", async ({ page }) => {
    const stops = recordPosts(page, "**/api/instances/alpha/stop")
    await sidebar(page).getByRole("button", { name: "Stop" }).click()
    await expect.poll(() => stops.length).toBe(1)
  })

  test("Restart stops the server, then starts it again", async ({ page }) => {
    const calls: string[] = []
    for (const action of ["stop", "start"]) {
      await page.route(`**/api/instances/alpha/${action}`, (route) => {
        calls.push(action)
        return route.fulfill({ json: {} })
      })
    }
    await sidebar(page).getByRole("button", { name: "Restart" }).click()
    await expect.poll(() => calls).toEqual(["stop", "start"])
  })

  test("Force Kill asks for confirmation before killing", async ({ page }) => {
    const kills = recordPosts(page, "**/api/instances/alpha/kill")
    await sidebar(page).getByRole("button", { name: "Force Kill" }).click()
    await expect(page.getByText("Are you sure you want to forcefully kill this server?")).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    expect(kills).toHaveLength(0)

    await sidebar(page).getByRole("button", { name: "Force Kill" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => kills.length).toBe(1)
  })

  test("the sidebar and Edit footer offer the same controls", async ({ page }) => {
    const footer = page.getByRole("region", { name: "Server controls" })
    await sidebar(page).getByRole("button", { name: "Edit" }).click()
    for (const name of ["Restart", "Stop", "Force Kill"]) {
      await expect(sidebar(page).getByRole("button", { name, exact: true })).toBeAttached()
      await expect(footer.getByRole("button", { name, exact: true })).toBeVisible()
    }
  })

  for (const action of ["Stop", "Force Kill", "Restart"]) {
    test(`${action} shows an indeterminate bar with no percentage`, async ({ page }) => {
      // Never answers, so the server stays mid-transition.
      await page.route(/\/api\/instances\/alpha\/(stop|kill)$/, () => {})
      await sidebar(page).getByRole("button", { name: action, exact: true }).click()
      if (action === "Force Kill") await page.getByRole("button", { name: "OK" }).click()
      const bar = sidebar(page).getByRole("progressbar")
      await expect(bar).toBeVisible()
      await expect(bar).not.toHaveAttribute("aria-valuenow")
      await expect(sidebar(page).getByText(/\d+%$/)).toHaveCount(0)
    })
  }

  test("a percentage reported by the server is shown", async ({ page }) => {
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({
        json: { instance_id: "alpha", is_running: true, is_ready: false, startup_status: "Loading mods...", startup_percent: 30, containers: [] },
      }),
    )
    await page.reload()
    await page.getByRole("main").getByText("Alpha Server").click()
    await expect(sidebar(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30")
    await expect(sidebar(page).getByText("30%")).toBeVisible()
  })
})

test.describe("Instance context menu", () => {
  const menu = (page: Page) => page.locator(".z-\\[1000\\]").filter({ hasText: "Rename" })

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/groups", (route) => route.fulfill({ json: ["No group", "Survival"] }))
    await openDashboard(page)
    await page.getByRole("main").getByText("Alpha Server").click({ button: "right" })
    await expect(menu(page)).toBeVisible()
  })

  test("opens on right-click with the instance's name and selects it", async ({ page }) => {
    await expect(menu(page)).toContainText("Alpha Server")
    await expect(page.getByRole("heading", { name: "Alpha Server" })).toBeVisible()
  })

  test("clicking elsewhere closes it", async ({ page }) => {
    await page.getByRole("main").click({ position: { x: 5, y: 5 } })
    await expect(menu(page)).toBeHidden()
  })

  test("Rename sends the new name", async ({ page }) => {
    const renames = recordPosts(page, "**/api/instances/alpha/rename")
    await menu(page).getByRole("button", { name: "Rename" }).click()
    const input = page.locator("#dialog-input")
    await expect(input).toHaveValue("Alpha Server")
    await input.fill("Renamed Server")
    await input.press("Enter")
    await expect.poll(() => renames).toEqual([{ name: "Renamed Server" }])
  })

  test("Rename with the same name sends nothing", async ({ page }) => {
    const renames = recordPosts(page, "**/api/instances/alpha/rename")
    await menu(page).getByRole("button", { name: "Rename" }).click()
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.locator("#dialog-input")).toHaveCount(0)
    expect(renames).toEqual([])
  })

  test("Change Group moves the server to the chosen group", async ({ page }) => {
    const moves = recordPosts(page, "**/api/instances/alpha/group")
    await menu(page).getByRole("button", { name: "Change Group..." }).click()
    await page.locator("#dialog-select").selectOption("Survival")
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => moves).toEqual([{ group: "Survival" }])
  })

  test("Change Group can create a new group", async ({ page }) => {
    const moves = recordPosts(page, "**/api/instances/alpha/group")
    await menu(page).getByRole("button", { name: "Change Group..." }).click()
    await page.locator("#dialog-select").selectOption("+ New Group...")
    await page.getByRole("button", { name: "OK" }).click()
    await page.locator("#dialog-input").fill("Creative")
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => moves).toEqual([{ group: "Creative" }])
  })

  test("Change Icon asks for an image", async ({ page }) => {
    const chooser = page.waitForEvent("filechooser")
    await menu(page).getByRole("button", { name: "Change Icon" }).click()
    expect((await chooser).isMultiple()).toBe(false)
  })

  test("Start starts the server; Restart, Stop and Force Kill are disabled while it is offline", async ({ page }) => {
    const starts = recordPosts(page, "**/api/instances/alpha/start")
    await expect(menu(page).getByRole("button", { name: "Restart" })).toBeDisabled()
    await expect(menu(page).getByRole("button", { name: "Stop" })).toBeDisabled()
    await expect(menu(page).getByRole("button", { name: "Force Kill" })).toBeDisabled()
    await menu(page).getByRole("button", { name: "Start", exact: true }).click()
    await expect.poll(() => starts.length).toBe(1)
    await expect(menu(page)).toBeHidden()
  })

  test("Edit... opens the Edit window", async ({ page }) => {
    await menu(page).getByRole("button", { name: "Edit..." }).click()
    await expect(page.getByRole("heading", { name: "Editing: Alpha Server" })).toBeVisible()
  })

  test("Folder opens the instance's files", async ({ page }) => {
    await menu(page).getByRole("button", { name: "Folder" }).click()
    await expect(page.getByTitle("New Folder")).toBeVisible()
  })

  test("Export... opens the Export window", async ({ page }) => {
    await menu(page).getByRole("button", { name: "Export..." }).click()
    await expect(page.getByText("Export Instance")).toBeVisible()
  })

  test("Duplicate suggests a name and creates the copy", async ({ page }) => {
    const copies = recordPosts(page, "**/api/instances/alpha/duplicate")
    await menu(page).getByRole("button", { name: "Duplicate" }).click()
    await expect(page.locator("#dialog-input")).toHaveValue("Copy of Alpha Server")
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => copies).toEqual([{ name: "Copy of Alpha Server" }])
  })

  test("Delete asks before deleting", async ({ page }) => {
    await menu(page).getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("permanently delete this instance")).toBeVisible()
  })
})

test.describe("Instance context menu on a running server", () => {
  test("Restart, Stop and Force Kill are offered, Start is disabled", async ({ page }) => {
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: true, is_ready: true, containers: [] } }),
    )
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    const stops = recordPosts(page, "**/api/instances/alpha/stop")
    await openDashboard(page)
    await page.getByRole("main").getByText(MOCK_INSTANCES[0].name).click({ button: "right" })
    const menu = page.locator(".z-\\[1000\\]").filter({ hasText: "Rename" })
    await expect(menu.getByRole("button", { name: "Start", exact: true })).toBeDisabled()
    await expect(menu.getByRole("button", { name: "Restart" })).toBeEnabled()
    await expect(menu.getByRole("button", { name: "Force Kill" })).toBeEnabled()
    await menu.getByRole("button", { name: "Stop" }).click()
    await expect.poll(() => stops.length).toBe(1)
  })
})
