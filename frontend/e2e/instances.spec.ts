import { test, expect, MOCK_INSTANCES } from "./fixtures"

test.describe("Instance selection and sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText("Beta Server").first()).toBeVisible()
  })

  test("clicking a card populates the sidebar with that instance", async ({ page, errors }) => {
    await page.getByText("Beta Server").first().click()
    await expect(page.getByRole("heading", { name: "Beta Server" })).toBeVisible()
    expect(errors.problems).toEqual([])
  })

  test("selecting another card switches the sidebar", async ({ page }) => {
    await page.getByText("Beta Server").first().click()
    await expect(page.getByRole("heading", { name: "Beta Server" })).toBeVisible()
    await page.getByText("Alpha Server").first().click()
    await expect(page.getByRole("heading", { name: "Alpha Server" })).toBeVisible()
  })
})

test.describe("Dashboard groups", () => {
  test("instances show under their group right after the page loads", async ({ page }) => {
    await page.route("**/api/groups", (route) => route.fulfill({ json: ["No group", "Survival"] }))
    await page.route("**/api/instances", (route) =>
      route.fulfill({ json: MOCK_INSTANCES.map((inst) => (inst.id === "beta" ? { ...inst, group: "Survival" } : inst)) }),
    )
    await page.goto("/")
    await expect(page.getByRole("main").getByText("Survival", { exact: true })).toBeVisible()
  })
})

test.describe("Instance name layout", () => {
  for (const width of [1440, 900]) {
    for (const group of ["No group", "Survival"]) {
      for (const name of ["Cobblemon Official Modpack Fabric", "A".repeat(120), "Alpha"]) {
        test(`${group}: ${name.slice(0, 40)} at ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 })
          await page.route("**/api/groups", (route) => route.fulfill({ json: ["No group", "Survival"] }))
          await page.route("**/api/instances", (route) =>
            route.fulfill({ json: [{ ...MOCK_INSTANCES[0], name, group }] }),
          )
          await page.goto("/")

          const cardName = page.getByRole("main").getByText(name, { exact: true })
          await cardName.click()
          const sidebarName = page.getByRole("heading", { name, exact: true })

          for (const label of [cardName, sidebarName]) {
            await expect(label).toBeVisible()
            const layout = await label.evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              const container = element.parentElement!.getBoundingClientRect()
              const text = element.firstChild!
              const wordLines = Array.from(element.textContent!.matchAll(/\S+/g), (match) => {
                const range = document.createRange()
                range.setStart(text, match.index!)
                range.setEnd(text, match.index! + match[0].length)
                return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size
              })
              return {
                wordLines,
                fits: bounds.left >= container.left && bounds.right <= container.right && element.scrollWidth <= element.clientWidth,
                height: bounds.height,
                lineHeight: parseFloat(getComputedStyle(element).lineHeight),
              }
            })
            if (name.includes(" ")) expect(layout.wordLines.every((lines) => lines === 1)).toBe(true)
            expect(layout.fits).toBe(true)
            await expect(label).toHaveAttribute("title", name)
            if (label === cardName) expect(layout.height).toBeLessThanOrEqual(layout.lineHeight * 2 + 1)
          }
        })
      }
    }
  }
})
