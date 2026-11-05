import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

type Entry = { name: string; is_dir: boolean; size: number; modified: number; ext: string }

const file = (name: string): Entry => ({ name, is_dir: false, size: 12, modified: 0, ext: name.includes(".") ? `.${name.split(".").pop()}` : "" })
const dir = (name: string): Entry => ({ name, is_dir: true, size: 0, modified: 0, ext: "" })

// A tiny in-memory file system behind the Files tab, keyed by folder path
let tree: Record<string, Entry[]>
let posts: { action: string; body: unknown }[]

async function openFiles(page: Page) {
  tree = {
    ".": [dir("world"), file("server.properties"), file("eula.txt")],
    world: [file("level.dat")],
  }
  posts = []
  await page.route("**/api/instances/alpha/files?**", (route) => {
    const path = new URL(route.request().url()).searchParams.get("path") || "."
    return route.fulfill({ json: { path, items: tree[path] || [] } })
  })
  await page.route(/\/api\/instances\/alpha\/files\/(create|rename|delete|copy|move|upload)$/, (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop()!
    const body = action === "upload" ? route.request().postData() : route.request().postDataJSON()
    posts.push({ action, body })
    if (action === "create") {
      const { name, is_dir } = body as { name: string; is_dir: boolean }
      tree["."].push(is_dir ? dir(name) : file(name))
    }
    return route.fulfill({ json: { ok: true } })
  })
  await page.route("**/api/instances/alpha/file/content?**", (route) =>
    route.fulfill({ json: { content: "motd=Hello from the test" } }),
  )
  await page.goto("/")
  await page.getByRole("main").getByText("Alpha Server").click()
  await page.locator("aside").getByRole("button", { name: "Folder" }).click()
  await expect(row(page, "server.properties")).toBeVisible()
}

const row = (page: Page, name: string) =>
  page.locator("div.grid.grid-cols-12").filter({ has: page.getByText(name, { exact: true }) })

test.describe("Files tab", () => {
  test.beforeEach(async ({ page }) => openFiles(page))

  test("double-clicking a folder opens it, and the breadcrumb and parent button go back", async ({ page }) => {
    await row(page, "world").dblclick()
    await expect(row(page, "level.dat")).toBeVisible()
    await page.getByTitle("Go to parent directory").click()
    await expect(row(page, "server.properties")).toBeVisible()

    await row(page, "world").dblclick()
    await expect(row(page, "level.dat")).toBeVisible()
    await page.getByText("root", { exact: true }).click()
    await expect(row(page, "server.properties")).toBeVisible()
  })

  test("double-clicking a text file shows its content, and the viewer closes", async ({ page }) => {
    await row(page, "server.properties").dblclick()
    await expect(page.getByText("motd=Hello from the test")).toBeVisible()
    await page.getByTitle("Download file").locator("xpath=following-sibling::button").click()
    await expect(page.getByText("motd=Hello from the test")).toBeHidden()
  })

  test("New Folder creates a folder from the typed name", async ({ page }) => {
    await page.getByTitle("New Folder").click()
    const name = page.getByPlaceholder("Folder name...")
    await name.fill("plugins")
    await name.press("Enter")
    await expect.poll(() => posts).toContainEqual({ action: "create", body: { path: ".", name: "plugins", is_dir: true } })
  })

  test("New File creates a file from the typed name", async ({ page }) => {
    await page.getByTitle("New File").click()
    const name = page.getByPlaceholder("File name...")
    await name.fill("notes.txt")
    await name.press("Enter")
    await expect.poll(() => posts).toContainEqual({ action: "create", body: { path: ".", name: "notes.txt", is_dir: false } })
  })

  test("Rename from the right-click menu sends the new name", async ({ page }) => {
    await row(page, "eula.txt").click({ button: "right" })
    await page.getByRole("button", { name: "Rename (F2)" }).click()
    // The rename box replaces the name and takes focus
    const input = page.locator("input:focus")
    await expect(input).toHaveValue("eula.txt")
    await input.fill("eula-old.txt")
    await input.press("Enter")
    await expect.poll(() => posts).toContainEqual({ action: "rename", body: { path: "eula.txt", new_name: "eula-old.txt" } })
  })

  test("F2 starts renaming the selected file", async ({ page }) => {
    await row(page, "eula.txt").click()
    await page.keyboard.press("F2")
    await expect(page.locator("input:focus")).toHaveValue("eula.txt")
  })

  test("Delete asks first, then deletes every selected item", async ({ page }) => {
    await row(page, "eula.txt").click()
    await row(page, "server.properties").click({ modifiers: ["ControlOrMeta"] })
    await page.getByTitle("Delete selected items").click()
    await expect(page.getByText("Are you sure you want to delete 2 items?")).toBeVisible()
    await page.getByRole("button", { name: "OK" }).click()
    await expect.poll(() => posts.filter((p) => p.action === "delete")).toHaveLength(1)
    const { paths } = posts.find((p) => p.action === "delete")!.body as { paths: string[] }
    expect(paths.sort()).toEqual(["eula.txt", "server.properties"])
  })

  test("the Delete key deletes the selection after confirming", async ({ page }) => {
    await row(page, "eula.txt").click()
    await page.keyboard.press("Delete")
    await expect(page.getByText('Are you sure you want to delete "eula.txt"?')).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    expect(posts).toEqual([])
  })

  test("Download opens the file's download link", async ({ page }) => {
    await row(page, "eula.txt").click()
    const popup = page.waitForEvent("popup")
    await page.getByTitle("Download selected items").click()
    expect((await popup).url()).toContain("/api/instances/alpha/files/download?path=eula.txt")
  })

  test("Copy and paste into another folder copies the file", async ({ page }) => {
    await row(page, "eula.txt").click()
    await page.getByTitle("Copy selected items").click()
    await row(page, "world").dblclick()
    await expect(row(page, "level.dat")).toBeVisible()
    await page.getByTitle(/^Paste 1 items/).click()
    await expect.poll(() => posts).toContainEqual({
      action: "copy",
      body: { source_paths: ["eula.txt"], destination_dir: "world", collision_strategy: "fail" },
    })
  })

  test("Cut and paste moves the file", async ({ page }) => {
    await row(page, "eula.txt").click()
    await page.getByTitle("Cut selected items").click()
    await row(page, "world").dblclick()
    await page.getByTitle(/^Paste 1 items/).click()
    await expect.poll(() => posts.map((p) => p.action)).toContain("move")
  })

  test("Upload sends the chosen files to the current folder", async ({ page }) => {
    const chooser = page.waitForEvent("filechooser")
    await page.getByTitle("Upload Files from OS").click()
    await (await chooser).setFiles({ name: "ops.json", mimeType: "application/json", buffer: Buffer.from("[]") })
    await expect.poll(() => posts.map((p) => p.action)).toContain("upload")
    expect(posts.find((p) => p.action === "upload")!.body).toContain('filename="ops.json"')
  })

  test("Refresh reloads the folder", async ({ page }) => {
    tree["."].push(file("new.log"))
    await page.getByTitle("Refresh file list").click()
    await expect(row(page, "new.log")).toBeVisible()
  })
})
