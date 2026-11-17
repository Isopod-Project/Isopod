"""Render the YouTube thumbnail (1280x720) with the real dashboard inside it.

    python thumbnail.py   # -> out/thumbnail.png
"""
from playwright.sync_api import sync_playwright

import serve

serve.build_app()
serve.HERE.joinpath("out").mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=serve.chrome_path())
    ctx = b.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
    ctx.route("**/*", serve.handle)
    page = ctx.new_page()
    page.goto(f"{serve.ORIGIN}/demo/thumbnail.html")
    frame = page.frame_locator("#frame")
    frame.get_by_text("Survival SMP").first.wait_for()
    page.evaluate("""async () => {
        const w = document.getElementById('frame').contentWindow;
        // A fuller dashboard than the video's opening state: more servers, most of them running
        const db = w.__demoDb;
        db.instances.push(
          { id: "hardcore", name: "Hardcore", group: "No group", type: "VANILLA", version: "1.21.4", port: 25568, memory: "2G", icon: "terralith" },
          { id: "minigames", name: "Minigames", group: "No group", type: "PAPER", version: "1.21.4", port: 25569, memory: "4G", icon: "chunky" },
          { id: "modded", name: "Modded", group: "Friends", type: "NEOFORGE", version: "1.21.1", port: 25570, memory: "6G", icon: "ferrite" },
        );
        for (const id of ["skyblock", "minigames", "modded"]) db.running[id] = -3600000;
        [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Refresh').click();
        await w.__vt.advanceTo(5500);
        await w.__vt.advanceTo(6000);
        await document.fonts.ready;
        for (let i = 0; i < 100 && ![...w.document.images].every(im => im.complete); i++) await new Promise(r => setTimeout(r, 20));
    }""")
    page.mouse.move(1279, 719)
    out = serve.HERE / "out" / "thumbnail.png"
    page.screenshot(path=str(out))
    print(out)
    b.close()
