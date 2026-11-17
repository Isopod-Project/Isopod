"""Render the Isopod demo video from the real dashboard UI.

    python render.py stills 2.0 6.4      # single frames -> out/still-<t>.png
    python render.py sheet               # a contact sheet per scene -> out/sheet-<n>.png, plus out/overview.png
    python render.py video [workers]     # out/isopod-demo.mp4 (frames, then audio.py, then mux)

The page is stage.html at 1920x1080; timeline.js drives the real app inside it. Each
worker renders a contiguous range of frames and pipes PNGs into its own ffmpeg; the
chunks are joined with the concat demuxer and muxed with the synthesized soundtrack.
"""
import json
import math
import multiprocessing as mp
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

import serve

FPS = 30
# `--portrait` anywhere on the command line renders the 1080x1920 Shorts/TikTok version
# (passed on through an environment variable so the worker processes inherit it)
if "--portrait" in sys.argv:
    sys.argv.remove("--portrait")
    os.environ["DEMO_PORTRAIT"] = "1"
PORTRAIT = os.environ.get("DEMO_PORTRAIT") == "1"
W, H = (1080, 1920) if PORTRAIT else (1920, 1080)
OUT = serve.HERE / "out"
NAME = "isopod"
SUFFIX = "-portrait" if PORTRAIT else ""


def open_stage(p):
    browser = p.chromium.launch(executable_path=serve.chrome_path())
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    ctx.route("**/*", serve.handle)
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("pageerror:", e, file=sys.stderr))
    page.on("console", lambda m: m.type == "error" and print("console:", m.text, file=sys.stderr))
    page.goto(f"{serve.ORIGIN}/demo/stage.html" + ("?layout=portrait" if PORTRAIT else ""))
    page.evaluate("window.STAGE_READY")
    return browser, page


def shot(page, t, path=None):
    m = page.evaluate(f"renderAt({t:.5f})")
    if m["hover"]:
        page.mouse.move(m["x"], m["y"])
    else:
        page.mouse.move(W - 1, H - 1)
    return page.screenshot(path=path, type="png")


def meta(page):
    return page.evaluate("({duration: DEMO.DURATION, scenes: DEMO.SCENES, sounds: SOUND_EVENTS, beats: DEMO.S})")


# ---- stills and sheets ---------------------------------------------------------------

def stills(times):
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b, page = open_stage(p)
        for t in sorted(times):
            path = OUT / f"still{SUFFIX}-{t:06.2f}.png"
            shot(page, t, str(path))
            print(path)
        b.close()


def sheet():
    from PIL import Image, ImageDraw
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b, page = open_stage(p)
        info = meta(page)
        overview = []
        for n, (name, t0, t1) in enumerate(info["scenes"], 1):
            times = [t0 + (t1 - t0) * k / 11 for k in range(12)]
            tiles = []
            for t in times:
                png = shot(page, t)
                from io import BytesIO
                tw, th = (360, 640) if PORTRAIT else (640, 360)
                img = Image.open(BytesIO(png)).convert("RGB").resize((tw, th))
                ImageDraw.Draw(img).text((8, 6), f"{t:.2f}s", fill=(220, 30, 30))
                tiles.append(img)
            cols = 6 if PORTRAIT else 3
            grid = Image.new("RGB", (tw * cols, th * (12 // cols)), "white")
            for k, img in enumerate(tiles):
                grid.paste(img, ((k % cols) * tw, (k // cols) * th))
            grid.save(OUT / f"sheet{SUFFIX}-{n}.png")
            overview.append(tiles[len(tiles) // 2])
            print(OUT / f"sheet{SUFFIX}-{n}.png", name)
        cols = 6 if PORTRAIT else 3
        rows = math.ceil(len(overview) / cols)
        grid = Image.new("RGB", (tw * cols, th * rows), "white")
        for k, img in enumerate(overview):
            grid.paste(img, ((k % cols) * tw, (k // cols) * th))
        grid.save(OUT / f"overview{SUFFIX}.png")
        print(OUT / f"overview{SUFFIX}.png")
        b.close()


# ---- video ---------------------------------------------------------------------------

def worker(args):
    idx, f0, f1 = args
    chunk = OUT / f"chunk{SUFFIX}-{idx:02d}.mp4"
    ff = subprocess.Popen(
        [serve.ffmpeg_path(), "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "png", "-i", "-",
         "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS), str(chunk)],
        stdin=subprocess.PIPE,
    )
    with sync_playwright() as p:
        b, page = open_stage(p)
        start = time.time()
        for f in range(f0, f1):
            ff.stdin.write(shot(page, f / FPS))
            if (f - f0) % 60 == 0:
                print(f"[w{idx}] frame {f}/{f1} ({(time.time() - start) / max(1, f - f0):.2f}s/frame)", flush=True)
        b.close()
    ff.stdin.close()
    ff.wait()
    return str(chunk)


def video(workers):
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b, page = open_stage(p)
        info = meta(page)
        b.close()
    (OUT / "events.json").write_text(json.dumps(info, indent=1))
    total = round(info["duration"] * FPS)
    bounds = [round(total * k / workers) for k in range(workers + 1)]
    jobs = [(k, bounds[k], bounds[k + 1]) for k in range(workers)]
    t0 = time.time()
    with mp.Pool(workers) as pool:
        chunks = pool.map(worker, jobs)
    print(f"frames done in {time.time() - t0:.0f}s")

    concat = OUT / f"chunks{SUFFIX}.txt"
    concat.write_text("".join(f"file '{Path(c).name}'\n" for c in chunks))
    silent = OUT / f"video-silent{SUFFIX}.mp4"
    subprocess.run([serve.ffmpeg_path(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)], check=True)
    for c in chunks:
        Path(c).unlink()
    concat.unlink()

    subprocess.run([sys.executable, str(serve.HERE / "audio.py")], check=True)
    mux()


def mux():
    final = OUT / f"{NAME}-demo{SUFFIX}.mp4"
    subprocess.run([serve.ffmpeg_path(), "-y", "-loglevel", "error", "-i", str(OUT / f"video-silent{SUFFIX}.mp4"), "-i", str(OUT / "audio.wav"),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(final)], check=True)
    print(final)


if __name__ == "__main__":
    serve.build_app()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "sheet"
    if cmd == "stills":
        stills([float(x) for x in sys.argv[2:]])
    elif cmd == "sheet":
        sheet()
    elif cmd == "video":
        video(int(sys.argv[2]) if len(sys.argv) > 2 else max(1, min(6, mp.cpu_count() // 2)))
    elif cmd == "mux":
        mux()
    else:
        sys.exit(__doc__)
