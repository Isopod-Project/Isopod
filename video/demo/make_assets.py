"""Generate the stand-in images the demo needs: server icons, mod icons and player heads.

All of them are simple 8x8 pixel-art blocks drawn here, not copies of real mod logos or
player skins. Run once; output goes to assets/ (committed) and is served at /demo/...
"""
import hashlib
import random
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICONS = HERE / "icons"
AVATARS = HERE / "assets" / "avatars"


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def block(name, rows, palette, size=128):
    img = Image.new("RGB", (8, 8))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            img.putpixel((x, y), hexrgb(palette[ch]))
    img.resize((size, size), Image.NEAREST).save(ICONS / f"{name}.png")


def noisy(name, base, accents, seed, top=None):
    rnd = random.Random(seed)
    rows = []
    for y in range(8):
        row = ""
        for x in range(8):
            if top and y < top[0]:
                row += rnd.choice(top[1])
            else:
                row += rnd.choice(base * 3 + accents)
        rows.append(row)
    pal = {"a": "#5d9b3a", "b": "#6fb043", "c": "#4b8a2f", "d": "#8b5a2b", "e": "#7a4e25", "f": "#9a6a38",
           "g": "#a8473a", "h": "#b9584a", "i": "#d9d4c7", "j": "#7ec3ef", "k": "#a6d8f7", "l": "#ffffff",
           "m": "#3c3c46", "n": "#55555f", "o": "#e8c547", "p": "#2f6db3", "q": "#c9c2b6", "r": "#e7e1d4",
           "s": "#d07a2c", "t": "#ef9b3d", "u": "#f2f2f2", "v": "#d63a3a", "w": "#2b2b2b", "x": "#5ac8a0",
           "y": "#3fa883", "z": "#8a6ad1"}
    block(name, rows, pal)


def head(name):
    seed = int(hashlib.sha1(name.encode()).hexdigest()[:8], 16)
    rnd = random.Random(seed)
    hair = rnd.choice(["#3b2a1a", "#6b4423", "#d8b45a", "#1e1e1e", "#8a3b1b"])
    skin = rnd.choice(["#e8b98f", "#c68a5e", "#f0c8a0", "#9a6440"])
    eye = rnd.choice(["#3a5fcd", "#2e7d32", "#5d4037"])
    rows = ["hhhhhhhh", "hhhhhhhh", "hsssssshh"[:8], "ssssssss", "sewssews", "ssssssss", "sssmmsss", "ssssssss"]
    pal = {"h": hair, "s": skin, "e": "#ffffff", "w": eye, "m": "#8a4f3a"}
    img = Image.new("RGB", (8, 8))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            img.putpixel((x, y), hexrgb(pal[ch]))
    for size in (32, 64):
        img.resize((size, size), Image.NEAREST).save(AVATARS / f"{name}.png")


def main():
    ICONS.mkdir(exist_ok=True)
    AVATARS.mkdir(parents=True, exist_ok=True)
    # Server icons
    noisy("grass", "dde", "f", 1, top=(2, "abc"))
    noisy("bricks", "gh", "q", 2)
    noisy("sky", "jk", "l", 3)
    noisy("fabric-test", "rq", "i", 4)
    # Mod icons (stand-ins, not the projects' real logos)
    noisy("lithium", "xy", "u", 11)
    noisy("fabric", "rq", "d", 12)
    noisy("ferrite", "mn", "q", 13)
    noisy("terralith", "ab", "j", 14)
    noisy("chunky", "st", "o", 15)
    noisy("spark", "o", "t", 16)
    noisy("waystones", "mn", "j", 19)
    noisy("balm", "ty", "u", 20)
    for name in ("Pillbug", "MossyCobble", "Tater_Tot", "steve"):
        head(name)


if __name__ == "__main__":
    main()
