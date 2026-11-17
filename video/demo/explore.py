"""Load the real app with the demo backend and screenshot it, for planning scenes.

    python explore.py out/explore.png [js-to-run-first]
"""
import asyncio
import sys

from playwright.async_api import async_playwright

import serve


async def main(out, script=""):
    serve.build_app()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=serve.chrome_path())
        ctx = await b.new_context(viewport={"width": 1600, "height": 776}, device_scale_factor=1)
        await serve.install(ctx)
        page = await ctx.new_page()
        page.on("console", lambda m: m.type in ("error", "warning") and print("console:", m.text))
        page.on("pageerror", lambda e: print("pageerror:", e))
        await page.goto(serve.ORIGIN + "/")
        await page.evaluate("__vt.advanceTo(500)")
        if script:
            print(await page.evaluate(f"(async () => {{ {script} }})()"))
        await page.screenshot(path=out)
        await b.close()


asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
