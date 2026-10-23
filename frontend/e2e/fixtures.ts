import { test as base, expect, type Page, type Route } from "@playwright/test"

// Deterministic backend stand-in. Every /api call made by the app is answered here,
// so the suite runs without the Python backend or Docker.
export const MOCK_INSTANCES = [
  { id: "alpha", name: "Alpha Server", path: "/servers/alpha", has_compose: false, status: "Valid", group: "No group" },
  { id: "beta", name: "Beta Server", path: "/servers/beta", has_compose: false, status: "Valid", group: "No group" },
]

const MOCK_SETTINGS = {
  theme: "Dark",
  language: "en",
  autoRefresh: false,
  showSnapshots: false,
  defaultPort: "25565",
  defaultMemory: "2G",
  defaultLoader: "vanilla",
  defaultWhitelistEnabled: false,
  defaultWhitelistUsers: [],
}

function jsonFor(path: string): unknown {
  if (path === "/api/instances") return MOCK_INSTANCES
  if (path === "/api/settings") return MOCK_SETTINGS
  if (path === "/api/groups") return ["No group"]
  if (path === "/api/files") return { path: ".", items: [] }
  if (path === "/api/meta/versions")
    return { versions: [{ id: "1.21.1", type: "release" }, { id: "24w01a", type: "snapshot" }] }
  if (path === "/api/system/check-updates")
    return { current_version: "0.0.0-test", has_update: false }
  if (path === "/api/resources")
    return {
      instances: {},
      total: { cpu_percent: 12.5, memory_used: 3 * 1024 ** 3, memory_allocated: 0, host_memory: 16 * 1024 ** 3, host_cpus: 8 },
    }
  if (path.endsWith("/status")) return { instance_id: "alpha", is_running: false, is_ready: false, containers: [] }
  if (path.endsWith("/logs")) return { logs: "" }
  if (path.endsWith("/players")) return { available: false, online: 0, max: 0, players: [] }
  if (path.endsWith("/users")) return { whitelist: [], ops: [], banned: [] }
  if (path.endsWith("/mods")) return []
  if (path.endsWith("/config")) return {}
  return []
}

async function handleApi(route: Route) {
  const url = new URL(route.request().url())
  const body = jsonFor(url.pathname)
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
}

/** Collects uncaught exceptions and console errors so every test can assert they never happen. */
export class ErrorCollector {
  readonly problems: string[] = []
  private readonly expected: RegExp[] = []

  /** Tests of failure paths call this for the console errors they cause on purpose. */
  expect(...patterns: RegExp[]) {
    this.expected.push(...patterns)
  }

  attach(page: Page) {
    page.on("pageerror", (err) => this.problems.push(`pageerror: ${err.message}`))
    page.on("console", (msg) => {
      const text = msg.text()
      if (msg.type() === "error" && !this.expected.some((p) => p.test(text))) this.problems.push(`console.error: ${text}`)
    })
  }
}

type Fixtures = {
  mockApi: void
  errors: ErrorCollector
}

export const test = base.extend<Fixtures>({
  mockApi: [async ({ page }, use) => {
    await page.route("**/api/**", handleApi)
    // External lookups (player/mod metadata) should never leave the test run.
    await page.route(/https?:\/\/(playerdb\.co|api\.modrinth\.com|piston-meta\.mojang\.com)\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    )
    await use()
  }, { auto: true }],
  errors: [async ({ page }, use) => {
    const collector = new ErrorCollector()
    collector.attach(page)
    await use(collector)
    expect(collector.problems, "unexpected runtime errors").toEqual([])
  }, { auto: true }],
})

export { expect }
