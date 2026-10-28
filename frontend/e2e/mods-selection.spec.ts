import { test, expect } from "./fixtures"

const mod = (name: string, enabled = true) => ({
  filename: `${name.toLowerCase().replace(" ", "")}.jar${enabled ? "" : ".disabled"}`,
  id: name.toLowerCase().replace(" ", ""),
  name,
  version: "1.0",
  enabled,
  size: 1024,
  modified: 0,
  modified_str: "2026-10-01",
  source: "local",
})

test.describe("Mods tab multi-selection", () => {
  let toggled: { filename: string; enabled: boolean }[]
  let deleted: string[]

  test.beforeEach(async ({ page }) => {
    toggled = []
    deleted = []
    let mods = [mod("Apple Mod"), mod("Banana Mod"), mod("Cherry Mod", false), mod("Damson Mod")]

    await page.route("**/api/instances/*/mods", (route) => route.fulfill({ json: mods }))
    await page.route("**/api/instances/*/mods/toggle", (route) => {
      const body = route.request().postDataJSON()
      toggled.push({ filename: body.filename, enabled: body.enabled })
      mods = mods.map((m) =>
        m.filename === body.filename
          ? { ...m, enabled: body.enabled, filename: m.filename.replace(/\.disabled$/, "") + (body.enabled ? "" : ".disabled") }
          : m,
      )
      return route.fulfill({ json: { ok: true } })
    })
    await page.route("**/api/instances/*/mods/delete", (route) => {
      const body = route.request().postDataJSON()
      deleted.push(body.filename)
      mods = mods.filter((m) => m.filename !== body.filename)
      return route.fulfill({ json: { ok: true } })
    })

    await page.goto("/")
    await page.getByText("Alpha Server").first().click()
    await page.getByRole("button", { name: "Edit" }).first().click()
    await page.getByRole("button", { name: "Mods", exact: true }).click()
    await expect(row(page, "Damson Mod")).toBeVisible()
  })

  const row = (page: import("@playwright/test").Page, name: string) => page.getByRole("row", { name: new RegExp(name) })

  test("ctrl+click and shift+click build a selection", async ({ page, errors }) => {
    await row(page, "Apple Mod").click()
    await row(page, "Cherry Mod").click({ modifiers: ["Shift"] })
    await expect(page.getByTestId("mod-selection-count")).toContainText("3 mods selected")

    await row(page, "Banana Mod").click({ modifiers: ["ControlOrMeta"] })
    await expect(page.getByTestId("mod-selection-count")).toContainText("2 mods selected")
    await expect(row(page, "Banana Mod")).toHaveAttribute("aria-selected", "false")
    await expect(row(page, "Cherry Mod")).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("Escape")
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(0)
    expect(errors.problems).toEqual([])
  })

  test("ctrl+a selects only mods matching the search filter", async ({ page }) => {
    await row(page, "Apple Mod").click()
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByTestId("mod-selection-count")).toContainText("4 mods selected")

    await page.locator('input[type="text"]').last().fill("e")
    await expect(row(page, "Banana Mod")).toHaveCount(0)
    // Hidden mods drop out of the selection
    await expect(page.getByTestId("mod-selection-count")).toContainText("2 mods selected")

    await row(page, "Apple Mod").click()
    await expect(page.getByTestId("mod-selection-count")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.getByTestId("mod-selection-count")).toContainText("2 mods selected")
  })

  test("batch disable and enable act only on mods that need it", async ({ page }) => {
    await row(page, "Apple Mod").click()
    await page.keyboard.press("ControlOrMeta+a")

    await page.getByRole("button", { name: "Disable (3)" }).click()
    await expect.poll(() => toggled.length).toBe(3)
    expect(toggled.every((t) => !t.enabled)).toBe(true)
    expect(toggled.map((t) => t.filename)).not.toContain("cherrymod.jar.disabled")

    // Selection survives the filename change to .disabled
    await expect(page.getByRole("button", { name: "Enable (4)" })).toBeEnabled()
    await page.getByRole("button", { name: "Enable (4)" }).click()
    await expect.poll(() => toggled.length).toBe(7)
  })

  test("batch remove asks once and deletes every selected mod", async ({ page }) => {
    await row(page, "Apple Mod").click()
    await row(page, "Damson Mod").click({ modifiers: ["ControlOrMeta"] })

    await page.getByRole("button", { name: "Remove (2)" }).click()
    await expect(page.getByText("Are you sure you want to remove 2 mods?")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()

    await expect(row(page, "Apple Mod")).toHaveCount(0)
    await expect(row(page, "Damson Mod")).toHaveCount(0)
    await expect(row(page, "Banana Mod")).toBeVisible()
    expect(deleted.sort()).toEqual(["applemod.jar", "damsonmod.jar"])
  })
})
