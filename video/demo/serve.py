"""Serving shared by render.py and the exploration helpers.

Everything is answered from disk through Playwright routing on http://demo.local, so the
stage (/demo/...) and the real app (/, /assets/...) share one origin and the stage can
reach into the app's iframe. Nothing goes to the network.
"""
import mimetypes
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
APP = HERE / ".appbuild"  # vite build output, made by build_app()
ORIGIN = "http://demo.local"

INJECT = "".join(
    f"<script>{(HERE / 'inject' / name).read_text(encoding='utf-8')}</script>"
    for name in ("clock.js", "backend.js")
) + "<style>*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;caret-color:transparent}</style>"


def build_app():
    """Build the real frontend into .appbuild (skipped if it is newer than every source file)."""
    src = REPO / "frontend" / "src"
    index = APP / "index.html"
    newest = max(p.stat().st_mtime for p in src.rglob("*") if p.is_file())
    if index.exists() and index.stat().st_mtime > newest:
        return
    import subprocess
    subprocess.run(
        f'npx vite build --outDir "{APP}" --emptyOutDir',
        cwd=REPO / "frontend", shell=True, check=True,
    )


def chrome_path():
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    return None  # Playwright's bundled Chromium


def ffmpeg_path():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    from shutil import which
    if which("ffmpeg"):
        return "ffmpeg"
    import imageio_ffmpeg  # pip install imageio-ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _file(route, path: Path, body_override=None):
    if not path.is_file():
        return route.fulfill(status=404, body="not found")
    ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if path.suffix == ".js":
        ctype = "text/javascript"
    body = body_override if body_override is not None else path.read_bytes()
    return route.fulfill(status=200, body=body, headers={"Content-Type": ctype, "Cache-Control": "no-store"})


def handle(route):
    url = route.request.url
    path = url.split(ORIGIN, 1)[1].split("?", 1)[0].split("#", 1)[0] if url.startswith(ORIGIN) else None
    if path is None:
        # Avatars and anything else external: never leave the machine.
        if "mc-heads.net/avatar/" in url or "crafthead.net/avatar/" in url:
            name = url.rstrip("/").split("/")[-2]
            return _file(route, HERE / "assets" / "avatars" / f"{name}.png")
        return route.fulfill(status=404, body="")
    if path.startswith("/demo/"):
        return _file(route, HERE / path[len("/demo/"):])
    if path.startswith("/repo/"):
        return _file(route, REPO / path[len("/repo/"):])
    if path == "/" or path == "/index.html":
        html = (APP / "index.html").read_text(encoding="utf-8")
        html = html.replace("<head>", "<head>" + INJECT, 1)
        return route.fulfill(status=200, body=html, headers={"Content-Type": "text/html"})
    return _file(route, APP / path.lstrip("/"))


async def install(context):
    await context.route("**/*", handle)
