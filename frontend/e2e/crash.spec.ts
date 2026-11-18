import { test, expect, MOCK_INSTANCES } from "./fixtures"
import type { Page } from "@playwright/test"

const REPORT = {
  name: "crash-2026-10-23_12.00.00-server.txt",
  created: 1792756800,
  text: [
    "---- Minecraft Crash Report ----",
    "Description: Exception in server tick loop",
    "",
    "java.lang.IllegalStateException: Failed to load chunk",
    "\tat net.minecraft.server.Foo.bar(Foo.java:10)",
    "Caused by: java.lang.NullPointerException: boom",
  ].join("\n"),
  description: "Exception in server tick loop",
  root_cause: "java.lang.NullPointerException: boom",
  suspects: ["Create (create)", "create-1.21-6.0.jar"],
}

async function mockStatus(page: Page, status: Record<string, unknown>) {
  await page.route("**/api/instances", (route) =>
    route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
  )
  await page.route("**/api/instances/*/status", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3]
    return route.fulfill({
      json: id === "alpha" ? { instance_id: "alpha", containers: [], ...status } : { instance_id: id, is_running: false, is_ready: false, containers: [] },
    })
  })
}

test.describe("Crash detection", () => {
  test("a crashed server is flagged, and its crash report can be inspected", async ({ page }) => {
    await mockStatus(page, {
      is_running: false,
      is_ready: false,
      crash: { state: "crashed", exit_code: 1, oom_killed: false, time: 1792756800 },
    })
    await page.route("**/api/instances/alpha/crash-report", (route) =>
      route.fulfill({ json: { report: REPORT, log_tail: "[Server thread/ERROR]: Encountered an unexpected exception" } }),
    )
    await page.goto("/")

    // Tile badge and sidebar status
    await expect(page.getByRole("main").getByText("Crashed (Code: 1)")).toBeVisible()
    await page.getByRole("main").getByText("Alpha Server").click()
    await expect(page.getByRole("complementary").getByText("Crashed (Code: 1)")).toBeVisible()

    const banner = page.getByRole("region", { name: "Crash" })
    await expect(banner).toContainText("stopped unexpectedly (exit code 1)")
    await banner.getByRole("button", { name: "View Crash Report" }).click()

    await expect(page.getByText("Root cause")).toBeVisible()
    await expect(page.getByText("java.lang.NullPointerException: boom").first()).toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: "Create (create)" })).toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: "create-1.21-6.0.jar" })).toBeVisible()
    await expect(page.getByLabel("Crash report text")).toContainText("Exception in server tick loop")
    await expect(page.getByText("Encountered an unexpected exception")).toBeVisible()

    await page.getByRole("button", { name: "Console" }).click()
    await expect(page.getByRole("button", { name: "Crash Report", exact: true })).toBeVisible()
  })

  test("without a crash report the inspector says so and shows the last log lines", async ({ page }) => {
    await mockStatus(page, {
      is_running: false,
      is_ready: false,
      crash: { state: "crashed", exit_code: 137, oom_killed: true, time: 1792756800 },
    })
    await page.route("**/api/instances/alpha/crash-report", (route) =>
      route.fulfill({ json: { report: null, log_tail: "java.lang.OutOfMemoryError: Java heap space" } }),
    )
    await page.goto("/")
    await expect(page.getByRole("main").getByText("Out of memory")).toBeVisible()
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.getByRole("button", { name: "View Crash Report" }).click()
    await expect(page.getByText(/No crash report found/)).toBeVisible()
    await expect(page.getByText("java.lang.OutOfMemoryError: Java heap space")).toBeVisible()
  })

  test("rollback suggestions show the recorded version and roll back only on request", async ({ page }) => {
    const SNAPSHOT = { name: "snapshot-20261020-120000.zip", reason: "Before changing mods", created: 1792500000 }
    const rollback = {
      snapshot: SNAPSHOT,
      changes: [{ id: "create", name: "Create", change: "updated", previous: "5.0", current: "6.0" }],
      suggestions: [
        {
          suspect: "Create (create)", id: "create", name: "Create", status: "previous_version",
          current: "6.0", previous: "5.0", snapshot: SNAPSHOT, available: true,
          reason: "Named as a suspect in the crash report, and it changed from 5.0 to 6.0 after this snapshot was taken.",
          group: [
            { id: "create", name: "Create", previous: "5.0", current: "6.0", modrinth: true },
            { id: "flywheel", name: "Flywheel", previous: "1.0", current: "1.1", modrinth: false },
          ],
          blockers: [], notes: [],
        },
        {
          suspect: "jei-2.jar", id: "jei", name: "JEI", status: "no_history", snapshot: null, available: false, group: [], notes: [],
          reason: "No snapshot was taken before the crash, so Isopod has no earlier version of this mod on record and won't guess one.",
        },
      ],
    }
    const posts: unknown[] = []
    await mockStatus(page, { is_running: false, is_ready: false, crash: { state: "crashed", exit_code: 1, time: 1792756800 } })
    await page.route("**/api/instances/alpha/crash-report", (route) =>
      route.fulfill({ json: { report: REPORT, log_tail: "", rollback } }),
    )
    await page.route("**/api/instances/alpha/crash-report/rollback", (route) => {
      posts.push(route.request().postDataJSON())
      return route.fulfill({ json: { restored: [{ name: "Create", version: "5.0" }, { name: "Flywheel", version: "1.0" }], files: [], pinned: [] } })
    })
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await page.getByRole("button", { name: "View Crash Report" }).click()

    const section = page.getByRole("region", { name: "Rollback suggestions" })
    const create = section.getByRole("listitem", { name: "Suggestion for Create" })
    await expect(create).toContainText("Previous version recorded")
    await expect(create).toContainText("6.0 now → 5.0 before")
    await expect(create).toContainText("Evidence: snapshot Before changing mods")
    await expect(create).toContainText("Flywheel: 1.1 → 1.0")
    await expect(section.getByRole("listitem", { name: "Suggestion for JEI" })).toContainText("won't guess one")
    await expect(section.getByRole("list", { name: "Mod changes" })).toContainText("Create: 5.0 → 6.0")
    await expect(section).toContainText("also rolls back the world")

    // Nothing changes until the user confirms
    await create.getByRole("button", { name: "Roll back 2 mods" }).click()
    await expect(page.getByText(/Only these files change/)).toBeVisible()
    expect(posts).toEqual([])
    await page.getByRole("button", { name: "OK" }).click()
    await expect(page.getByText("Rolled back Create to 5.0, Flywheel to 1.0.", { exact: false })).toBeVisible()
    expect(posts).toEqual([{ mod_id: "create", snapshot: SNAPSHOT.name }])
  })

  test("a halted crash loop explains itself, and Dismiss clears it", async ({ page }) => {
    let crash: Record<string, unknown> | null = { state: "halted", exit_code: 1, count: 3, time: 1792756800 }
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => ({ ...inst, has_compose: true })) }),
    )
    await page.route("**/api/instances/*/status", (route) =>
      route.fulfill({ json: { instance_id: "alpha", is_running: false, is_ready: false, containers: [], crash } }),
    )
    await page.route("**/api/instances/alpha/crash", (route) => {
      crash = null
      return route.fulfill({ json: { dismissed: true } })
    })
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    const banner = page.getByRole("region", { name: "Crash" })
    await expect(banner).toContainText("crashed 3 times within 2 minutes, so Isopod stopped restarting it")
    await expect(page.getByRole("complementary").getByText("Crash loop stopped")).toBeVisible()

    await banner.getByRole("button", { name: "Dismiss" }).click()
    await expect(banner).toHaveCount(0)
  })

  test("a server that restarted after a crash says so without a crash badge", async ({ page }) => {
    await mockStatus(page, {
      is_running: true,
      is_ready: true,
      crash: { state: "recovered", exit_code: 1, time: 1792756800 },
    })
    await page.goto("/")
    await page.getByRole("main").getByText("Alpha Server").click()
    await expect(page.getByRole("region", { name: "Crash" })).toContainText("was restarted automatically")
    await expect(page.getByRole("main").getByText(/Crashed|Crash loop/)).toHaveCount(0)
  })
})

test("the restart policy is saved with the configuration", async ({ page }) => {
  const puts: Record<string, unknown>[] = []
  await page.route("**/api/instances/*/config", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON())
      return route.fulfill({ json: { message: "Config updated" } })
    }
    return route.fulfill({ json: { image: "itzg/minecraft-server", environment: { VERSION: "1.21.4" }, restart_policy: "always" } })
  })
  await page.goto("/")
  await page.getByText("Alpha Server").first().click()
  await page.getByRole("button", { name: "Edit" }).first().click()
  await page.getByRole("button", { name: "Configuration" }).click()

  await expect(page.getByLabel("Restart automatically")).toHaveValue("always")
  await page.getByLabel("Restart automatically").selectOption("on-failure")
  await expect(page.getByText("Unsaved Changes")).toBeVisible()
  await page.getByRole("button", { name: "Save Changes" }).click()
  await page.getByRole("button", { name: "OK" }).click()

  await expect.poll(() => puts.length).toBe(1)
  expect(puts[0]).toMatchObject({ restart_policy: "on-failure" })
})
