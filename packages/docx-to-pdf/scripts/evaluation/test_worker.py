# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Synthetic protocol tests. Run with the evaluator's Python environment."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import pymupdf
from worker import RGB_SIZE, compare, evidence, measure, preview_page, read, write


class ProtocolTests(unittest.TestCase):
    def variant(
        self,
        path,
        text="Synthetic anchor",
        x=72,
        y=95,
        graphic=True,
        color=(1, 0, 0),
        text_page=1,
        metadata=None,
    ):
        with pymupdf.open() as doc:
            for number in range(1, text_page + 1):
                page = doc.new_page()
                if number == text_page:
                    page.insert_text((x, y), text)
                    if graphic:
                        page.draw_rect((300, 300, 312, 312), color=color, fill=color)
            if metadata:
                doc.set_metadata(metadata)
            doc.save(path)

    def variants(self, left=None, right=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.variant(root / "a.pdf", **(left or {}))
            self.variant(root / "b.pdf", **(right or {}))
            return compare(measure(root / "a.pdf"), measure(root / "b.pdf"))

    def pdf(self, path, pages=1, header=True, table=True):
        with pymupdf.open() as doc:
            for _ in range(pages):
                page = doc.new_page()
                if header:
                    page.insert_text((72, 35), "Synthetic recurring header")
                page.insert_text((72, 95), "Synthetic paragraph content")
                if table:
                    for y in (120, 150, 180):
                        page.draw_line((72, y), (300, y))
                    for x in (72, 180, 300):
                        page.draw_line((x, 120), (x, 180))
                    page.insert_text((80, 140), "Cell one")
            doc.save(path)

    def test_identical_pdf_is_equal(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.pdf"
            self.pdf(path)
            value = measure(path)
            self.assertEqual(compare(value, value)["findings"], [])
            self.assertIsNone(compare(value, value)["firstDivergence"])
            target = Path(temp) / "measurement.json.gz"
            write(target, value)
            self.assertEqual(read(target), value)

    def test_added_text_has_candidate_location(self):
        result = self.variants(right={"text": "Synthetic anchor added"})
        finding = next(f for f in result["findings"] if f["kind"] == "text-added")
        self.assertEqual(finding["unmatchedWords"], 1)
        self.assertEqual(finding["coordinateSpace"], "candidate")
        self.assertEqual(finding["excerpt"], "added")
        self.assertEqual(result["firstDivergence"]["type"], "text-added")

    def test_missing_text_uses_actual_page_and_bbox(self):
        result = self.variants(
            left={"text": "Synthetic anchor missing", "text_page": 2},
            right={"text_page": 2},
        )
        first = result["firstDivergence"]
        self.assertEqual(first["type"], "text-coverage")
        self.assertEqual(first["page"], 2)
        self.assertEqual(first["excerpt"], "missing")
        self.assertGreater(first["bbox"][0], 72)
        self.assertTrue(first["untrusted"])

    def test_small_graphic_removal_is_detected_locally(self):
        result = self.variants(right={"graphic": False})
        visual = next(f for f in result["findings"] if f["kind"] == "visual-region")
        self.assertLess(visual["changedFraction"], 0.01)
        self.assertEqual(visual["screeningMode"], "local-rgb")
        self.assertEqual(result["firstDivergence"]["confidence"], "low")
        self.assertLess(visual["bbox"][0], 312)
        self.assertGreater(visual["bbox"][2], 300)

    def test_equal_luminance_color_change_is_detected(self):
        # Red and this green have nearly equal grayscale luminance.
        result = self.variants(right={"color": (0, 0.51, 0)})
        self.assertTrue(any(f["kind"] == "visual-region" for f in result["findings"]))
        self.assertEqual(result["movement"]["missingWordCount"], 0)

    def test_text_shift_and_cross_page_have_grounded_divergence(self):
        shifted = self.variants(right={"y": 107})
        self.assertEqual(shifted["firstDivergence"]["type"], "text-position")
        self.assertEqual(shifted["firstDivergence"]["excerpt"], "Synthetic")
        shifted_first = shifted["firstDivergence"]
        self.assertEqual(shifted_first["candidateLocation"]["page"], 1)
        self.assertEqual(shifted_first["candidateLocation"]["coordinateSpace"], "candidate")
        self.assertEqual(shifted_first["deltaPt"], {"x": 0, "y": 12})
        self.assertEqual(shifted_first["deltaCoordinateSpace"], "page-local")
        self.assertAlmostEqual(shifted_first["candidateLocation"]["bbox"][1] - shifted_first["bbox"][1], 12)
        moved = self.variants(right={"text_page": 2})
        self.assertEqual(moved["firstDivergence"]["type"], "pagination")
        self.assertEqual(moved["firstDivergence"]["page"], 1)
        self.assertEqual(moved["firstDivergence"]["excerpt"], "Synthetic")
        self.assertEqual(moved["firstDivergence"]["candidateLocation"]["page"], 2)
        self.assertEqual(moved["firstDivergence"]["deltaPt"], {"x": 0, "y": 0})
        self.assertEqual(moved["firstDivergence"]["deltaCoordinateSpace"], "page-local")

    def test_paired_location_uses_the_first_shifted_word(self):
        result = self.variants(right={"x": 81, "y": 99})
        finding = next(f for f in result["findings"] if f["kind"] == "text-position")
        self.assertEqual(finding["deltaPt"], {"x": 9, "y": 4})
        self.assertEqual(finding["candidateLocation"]["bbox"][0], 81)
        self.assertEqual(result["firstDivergence"]["candidateLocation"], finding["candidateLocation"])

    def test_nonvisual_metadata_and_small_color_noise_are_controls(self):
        for candidate in (
            {"metadata": {"title": "Different metadata"}},
            {"color": (0.99, 0, 0)},
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(self.variants(right=candidate)["findings"], [])

    def test_old_measurements_still_compare(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.pdf"
            self.pdf(path)
            current = measure(path)
            old = deepcopy(current)
            old["pages"][0].pop("rgbSketch")
            old["pages"][0].pop("rgbSketchSize")
            result = compare(old, current)
            self.assertEqual(result["findings"], [])
            self.assertEqual(result["pages"][0]["mode"], "legacy-grayscale")
            self.assertEqual(current["pages"][0]["rgbSketchSize"], list(RGB_SIZE))

    def test_divergence_excerpt_is_bounded_and_marked_untrusted(self):
        result = self.variants(right={"text": "a" * 125, "x": 1})
        excerpts = [f for f in result["findings"] if f.get("excerpt")]
        self.assertTrue(excerpts)
        self.assertTrue(all(len(f["excerpt"]) <= 120 for f in excerpts))
        self.assertTrue(all(f["untrusted"] for f in excerpts))

    def test_missing_header_and_table_are_visible(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.pdf(root / "a.pdf")
            self.pdf(root / "b.pdf", header=False, table=False)
            result = compare(measure(root / "a.pdf"), measure(root / "b.pdf"))
            self.assertGreater(result["movement"]["missingWordCount"], 0)
            self.assertTrue(any(f["kind"] == "visual-region" for f in result["findings"]))
            detail = evidence(root / "a.pdf", root / "b.pdf", root / "evidence", [1])
            self.assertGreater(detail["pages"][0]["changedPixels"], 0)
            self.assertTrue((root / "evidence/1-crop.png").exists())

    def test_page_count_difference_is_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.pdf(root / "a.pdf", pages=2)
            self.pdf(root / "b.pdf")
            result = compare(measure(root / "a.pdf"), measure(root / "b.pdf"))
            self.assertTrue(any(f["kind"] == "pagination" for f in result["findings"]))

    def test_corrupt_pdf_and_unknown_protocol_refuse(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.pdf"
            path.write_bytes(b"broken")
            with self.assertRaises(pymupdf.FileDataError):
                measure(path)
        with self.assertRaises(ValueError):
            compare({"protocol": 99}, {"protocol": 1})


class PagePreviewTests(unittest.TestCase):
    def test_rotated_page_coordinates_and_missing_page(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with pymupdf.open() as document:
                page = document.new_page(width=200, height=300)
                page.insert_text((20, 30), "Synthetic page")
                page.set_rotation(90)
                document.save(root / "page.pdf")
            result = preview_page(root / "page.pdf", root / "preview", 1)
            self.assertEqual((result["widthPt"], result["heightPt"]), (300, 200))
            self.assertEqual(result["rotationMatrix"], [0, 1, -1, 0, 300, 0])
            self.assertTrue((root / "preview/page.png").is_file())
            for number in [0, 2, 1001]:
                with self.assertRaises(ValueError):
                    preview_page(root / "page.pdf", root / "preview", number)


if __name__ == "__main__":
    unittest.main()
