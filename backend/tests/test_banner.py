"""Startup logo (#25).

Run from the repo root: python -m unittest discover backend/tests
"""
import io
import os
import re
import unittest
from pathlib import Path
from unittest import mock

from backend import banner


class LogoGridTest(unittest.TestCase):
    def test_grid_is_symmetric_and_fills_whole_text_rows(self):
        self.assertEqual(len(banner.LOGO) % 2, 0)
        for row in banner.LOGO:
            self.assertEqual(row, row[::-1])
            self.assertEqual(len(row), len(banner.LOGO[0]))

    def test_every_letter_has_a_color(self):
        letters = set("".join(banner.LOGO)) - {"."}
        self.assertEqual(letters, set(banner.COLORS))

    def test_dashboard_draws_the_same_grid(self):
        path = Path(__file__).parents[2] / "frontend" / "src" / "components" / "IsopodLogo.tsx"
        grid = re.search(r"const LOGO = \[(.*?)\];", path.read_text(encoding="utf-8"), re.S).group(1)
        self.assertEqual(re.findall(r'"([^"]+)"', grid), banner.LOGO)


class RenderTest(unittest.TestCase):
    def test_one_text_row_per_two_pixel_rows(self):
        self.assertEqual(len(banner.logo_lines()), len(banner.LOGO) // 2)

    def test_two_colors_in_one_cell_use_foreground_and_background(self):
        self.assertEqual(banner._cell("r", "o"), ("▀", "38;5;167;48;5;209"))

    def test_half_filled_cells_use_half_blocks(self):
        self.assertEqual(banner._cell("b", ".")[0], "▀")
        self.assertEqual(banner._cell(".", "b")[0], "▄")

    def test_colored_lines_end_with_a_reset(self):
        for line in banner.logo_lines():
            self.assertEqual(re.findall(r"\x1b\[[^m]*m", line)[-1], "\x1b[0m")

    def test_no_color_has_no_escape_codes(self):
        self.assertNotIn("\x1b", "\n".join(banner.banner_lines("v1.2.3", color=False)))

    def test_banner_shows_name_and_version(self):
        text = "\n".join(banner.banner_lines("v1.2.3", color=False))
        self.assertIn("Isopod", text)
        self.assertIn("v1.2.3", text)


class PrintBannerTest(unittest.TestCase):
    def test_no_color_env_turns_color_off(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"NO_COLOR": "1"}), mock.patch("sys.stdout", out):
            banner.print_banner("v1.2.3")
        self.assertNotIn("\x1b", out.getvalue())

    def test_terminal_without_unicode_falls_back_to_plain_text(self):
        out = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
        with mock.patch("sys.stdout", out):
            banner.print_banner("v1.2.3")
        out.flush()
        self.assertIn(b"Isopod v1.2.3", out.buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
