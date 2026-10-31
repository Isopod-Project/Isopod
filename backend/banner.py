"""Block-character Isopod logo printed to the terminal at startup (#25)."""
import os

# One letter per pixel, "." is empty. frontend/src/components/IsopodLogo.tsx draws the same grid.
LOGO = [
    ".bb...........bb.",
    "...bb.......bb...",
    ".....b.bbb.b.....",
    ".....bbbbbbb.....",
    "...rrrrbbbrrrr...",
    "..rrrrrrwrrrrrr..",
    "..ooooowwwooooo..",
    ".oooooowwwoooooo.",
    ".yyyyyywwwyyyyyy.",
    ".yyyyyywwwyyyyyy.",
    "lllllllwwwlllllll",
    "lllllllwwwlllllll",
    "gggggggwwwggggggg",
    "gggggggwwwggggggg",
    ".uuuuuuwwwuuuuuu.",
    ".uuuuuuwwwuuuuuu.",
    ".pppppppwppppppp.",
    "..ppppppwpppppp..",
    "...bbbbbwbbbbb...",
    "...bbbbbbbbbbb...",
    ".....bbbbbbb.....",
    ".......bbb.......",
]

# xterm 256-color codes. Not every terminal supports 24-bit color.
COLORS = {"b": 137, "r": 167, "o": 209, "y": 221, "l": 114, "g": 35, "u": 74, "p": 98, "w": 255}


def _cell(top, bottom):
    """Returns the character and color codes that show two stacked pixels in one text cell."""
    if top == bottom:
        return (" ", "") if top == "." else ("█", f"38;5;{COLORS[top]}")
    if bottom == ".":
        return "▀", f"38;5;{COLORS[top]}"
    if top == ".":
        return "▄", f"38;5;{COLORS[bottom]}"
    return "▀", f"38;5;{COLORS[top]};48;5;{COLORS[bottom]}"


def logo_lines(color=True):
    lines = []
    for top_row, bottom_row in zip(LOGO[0::2], LOGO[1::2]):
        line = ""
        active = ""
        for top, bottom in zip(top_row, bottom_row):
            char, style = _cell(top, bottom)
            if not color:
                # Without color the two pixels can't be told apart, so show them as solid.
                char = "█" if top != "." and bottom != "." else char
            elif style != active:
                line += f"\x1b[0;{style}m" if style else "\x1b[0m"
                active = style
            line += char
        lines.append(line + ("\x1b[0m" if color and active else ""))
    return lines


def banner_lines(version, color=True):
    lines = logo_lines(color)
    middle = len(lines) // 2
    bold, reset = ("\x1b[1m", "\x1b[0m") if color else ("", "")
    lines[middle - 1] += f"   {bold}Isopod{reset}"
    lines[middle] += f"   {version}"
    return lines


def print_banner(version):
    # flush: Python buffers stdout under Docker, where there is no TTY.
    # NO_COLOR is the usual off switch for log viewers that show raw color codes (no-color.org).
    try:
        print("\n".join(banner_lines(version, color=not os.environ.get("NO_COLOR"))), flush=True)
    except UnicodeEncodeError:
        # A dev terminal without UTF-8 (e.g. cp1252 on Windows) must not stop startup.
        print(f"Isopod {version}", flush=True)
