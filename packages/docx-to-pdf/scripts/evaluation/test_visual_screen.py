# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Synthetic checks for byte-exact visual screening thresholds and regions."""

import base64
import unittest

from worker import RGB_SIZE, visual_screen


def page(pixels=None, *, color=True):
    width, height = RGB_SIZE if color else (48, 64)
    data = bytes(width * height * (3 if color else 1)) if pixels is None else bytes(pixels)
    result = {"size": [600, 800], "sketch": base64.b64encode(data).decode()}
    if color:
        result.update(rgbSketch=result["sketch"], rgbSketchSize=list(RGB_SIZE))
    return result


class VisualScreenTests(unittest.TestCase):
    def test_identical_pages_have_no_difference(self):
        for color in (True, False):
            with self.subTest(color=color):
                result = visual_screen(page(color=color), page(color=color))
                self.assertEqual(result["changedFraction"], 0)
                self.assertFalse(result["detected"])
                self.assertIsNone(result["bbox"])

    def test_each_color_channel_uses_the_same_strict_threshold(self):
        for channel in range(3):
            for amount in (24, 25):
                with self.subTest(channel=channel, amount=amount):
                    data = bytearray(RGB_SIZE[0] * RGB_SIZE[1] * 3)
                    for pixel in (0, 1, 2):
                        data[pixel * 3 + channel] = amount
                    result = visual_screen(page(), page(data))
                    self.assertEqual(result["detected"], amount == 25)
                    self.assertEqual(result["region"], "header" if amount == 25 else None)
                    if amount == 25:
                        self.assertEqual(result["bbox"], [0.0, 0.0, 12.5, 4.17])
                        self.assertEqual(result["changedFraction"], round(3 / (144 * 192), 5))

    def test_difference_is_symmetric_and_counts_pixels_once(self):
        data = bytearray(RGB_SIZE[0] * RGB_SIZE[1] * 3)
        start = (RGB_SIZE[1] - 1) * RGB_SIZE[0]
        for pixel in (start, start + 1, start + 2):
            data[pixel * 3:pixel * 3 + 3] = bytes([255, 128, 64])
        forward = visual_screen(page(), page(data))
        self.assertEqual(forward, visual_screen(page(data), page()))
        self.assertEqual(forward["changedFraction"], round(3 / (144 * 192), 5))
        self.assertEqual(forward["region"], "footer")

    def test_two_changed_pixels_do_not_trigger_a_color_tile(self):
        data = bytearray(RGB_SIZE[0] * RGB_SIZE[1] * 3)
        data[0] = data[3] = 255
        self.assertFalse(visual_screen(page(), page(data))["detected"])

    def test_legacy_grayscale_keeps_its_fraction_threshold(self):
        for count in (30, 31):
            for amount in (12, 13):
                data = bytearray(48 * 64)
                data[:count] = bytes([amount]) * count
                result = visual_screen(page(color=False), page(data, color=False))
                self.assertEqual(result["detected"], count == 31 and amount == 13)
                self.assertEqual(result["mode"], "legacy-grayscale")

    def test_invalid_lengths_remain_errors(self):
        for color in (True, False):
            with self.assertRaisesRegex(ValueError, "Invalid visual sketch size"):
                visual_screen(page(color=color), page(b"x", color=color))


if __name__ == "__main__":
    unittest.main()
