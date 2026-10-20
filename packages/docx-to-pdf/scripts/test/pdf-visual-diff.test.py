#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Tests for scripts/pdf-visual-diff.py."""

from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parents[1] / "pdf-visual-diff.py"
SPEC = importlib.util.spec_from_file_location("pdf_visual_diff", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def page(mark_x: int) -> Image.Image:
    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((mark_x, 40, mark_x + 40, 80), fill="black")
    return image


def write_pdf(path: Path, pages: list[Image.Image]) -> None:
    pages[0].save(
        path,
        "PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=72,
    )


def word(
    text: str,
    page_number: int,
    x: float,
    y: float,
    width: float = 20,
) -> dict[str, object]:
    return {
        "text": text,
        "page": page_number,
        "x0": x,
        "y0": y,
        "x1": x + width,
        "y1": y + 10,
    }


@unittest.skipUnless(
    shutil.which("pdfinfo") and shutil.which("pdftoppm") and shutil.which("pdftotext"),
    "Poppler is required",
)
class PdfVisualDiffTest(unittest.TestCase):
    def test_reading_order_drift_is_not_sorted_by_largest_downstream_error(self):
        reference = [word('first', 1, 20, 10), word('middle', 1, 20, 300),
                     word('last', 1, 20, 600), word('later', 20, 20, 10)]
        candidate = [word('first', 1, 20, 11), word('middle', 1, 20, 305),
                     word('last', 1, 20, 610), word('later', 20, 20, 60)]
        summary, _ = MODULE.compare_word_movement(reference, candidate)
        self.assertEqual(summary['largestMovements'][0]['referencePage'], 20)
        self.assertEqual(summary['earliestMovements'][0]['text'], 'first')
        self.assertEqual(summary['pageDrift'][0]['topThirdDeltaYPt'], 1)
        self.assertEqual(summary['pageDrift'][0]['bottomThirdDeltaYPt'], 10)
        self.assertEqual(summary['pageDrift'][0]['medianDeltaYPt'], 5)

    def test_reports_page_pixel_differences_and_writes_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.pdf"
            candidate = root / "candidate.pdf"
            output = root / "result"
            same = page(20)
            write_pdf(reference, [page(20), same])
            write_pdf(candidate, [page(24), same])

            status = MODULE.main(
                [
                    str(reference),
                    str(candidate),
                    "--output",
                    str(output),
                    "--dpi",
                    "72",
                    "--strong-threshold",
                    "28",
                ]
            )

            self.assertEqual(status, 0)
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["referencePages"], 2)
            self.assertEqual(report["candidatePages"], 2)
            self.assertFalse(report["pageCountMismatch"])
            self.assertGreater(report["pages"][0]["changedPixelsByThreshold"]["28"], 0)
            self.assertEqual(report["pages"][1]["changedPixelsByThreshold"]["28"], 0)
            self.assertIsNotNone(report["pages"][0]["strongDifferenceBoundsPx"])
            self.assertTrue((output / "pages/page-0001/diff-overlay.png").is_file())
            self.assertTrue((output / "pages/page-0001/diff-overlay-strong.png").is_file())
            self.assertTrue((output / "pages/page-0001/montage.png").is_file())

    def test_marks_a_missing_candidate_page_as_changed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.pdf"
            candidate = root / "candidate.pdf"
            output = root / "result"
            write_pdf(reference, [page(20), page(80)])
            write_pdf(candidate, [page(20)])

            status = MODULE.main(
                [
                    str(reference),
                    str(candidate),
                    "--output",
                    str(output),
                    "--dpi",
                    "72",
                ]
            )

            self.assertEqual(status, 0)
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertTrue(report["pageCountMismatch"])
            self.assertFalse(report["pages"][1]["candidatePresent"])
            self.assertGreater(report["pages"][1]["changedPixelsByThreshold"]["28"], 0)

    def test_force_only_replaces_marked_output_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "result"
            output.mkdir()
            (output / "user-file.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                MODULE.prepare_output(output, force=True)

    def test_rejects_pixel_budget_before_creating_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.pdf"
            candidate = root / "candidate.pdf"
            output = root / "result"
            write_pdf(reference, [page(20)])
            write_pdf(candidate, [page(20)])

            with self.assertRaises(RuntimeError):
                MODULE.main(
                    [
                        str(reference),
                        str(candidate),
                        "--output",
                        str(output),
                        "--max-pixels",
                        "1",
                    ]
                )

            self.assertFalse(output.exists())

    def test_validates_strong_threshold(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.parse_thresholds("0,8", 256)

    def test_ink_distance_separates_one_pixel_from_far_movement(self) -> None:
        reference = page(20)
        near = page(21)
        far = page(40)

        near_metrics = MODULE.ink_distance_metrics(reference, near, 72)
        far_metrics = MODULE.ink_distance_metrics(reference, far, 72)

        self.assertEqual(near_metrics["distanceBuckets"]["beyond8Pt"], 0)
        self.assertGreater(far_metrics["distanceBuckets"]["beyond8Pt"], 0)
        self.assertGreater(
            far_metrics["farUnmatchedFraction"],
            near_metrics["farUnmatchedFraction"],
        )

    def test_text_movement_makes_cross_page_changes_critical(self) -> None:
        reference = [word("alpha", 1, 10, 10), word("beta", 1, 40, 10)]
        candidate = [word("alpha", 1, 11, 10), word("beta", 2, 40, 10)]

        summary, pairs = MODULE.compare_word_movement(reference, candidate)

        self.assertEqual(summary["severity"], "critical")
        self.assertEqual(summary["distanceBuckets"]["crossPage"], 1)
        self.assertEqual(pairs[0]["distancePt"], 1)
        self.assertIsNone(pairs[1]["distancePt"])

    def test_text_movement_ranks_far_changes_above_small_changes(self) -> None:
        reference = [word("alpha", 1, 10, 10)]
        near, _ = MODULE.compare_word_movement(reference, [word("alpha", 1, 11, 10)])
        far, _ = MODULE.compare_word_movement(reference, [word("alpha", 1, 30, 10)])

        self.assertEqual(near["severity"], "minor")
        self.assertEqual(far["severity"], "major")
        self.assertGreater(far["movementScore"], near["movementScore"])

    def test_text_movement_pairs_repeated_words_in_reading_order(self) -> None:
        reference = [
            word("the", 1, 10, 10),
            word("the", 1, 40, 10),
            word("the", 1, 70, 10),
        ]
        candidate = [
            word("the", 1, 10, 10),
            word("the", 1, 60, 10),
            word("the", 1, 70, 10),
        ]

        summary, pairs = MODULE.compare_word_movement(reference, candidate)

        self.assertEqual(summary["distanceBuckets"]["beyond8Pt"], 1)
        self.assertEqual([pair["distancePt"] for pair in pairs], [0, 20, 0])

    def test_text_movement_repairs_distant_repeated_label_pairs(self) -> None:
        reference = [
            word("место", 1, 10, 10),
            word("alpha", 1, 40, 10),
            word("место", 1, 10, 100),
            word("beta", 1, 40, 100),
        ]
        candidate = [
            word("alpha", 1, 40, 22),
            word("место", 1, 10, 22),
            word("beta", 1, 40, 112),
            word("место", 1, 10, 112),
        ]

        summary, pairs = MODULE.compare_word_movement(reference, candidate)
        repeated = [pair["distancePt"] for pair in pairs if pair["text"] == "место"]

        self.assertEqual(repeated, [12, 12])
        self.assertEqual(summary["maxDistancePt"], 12)

    def test_text_movement_skips_extra_repeated_labels(self) -> None:
        reference = [word("место", 1, 10, 100), word("место", 1, 10, 500)]
        candidate = [
            word("место", 1, 10, 10),
            word("место", 1, 10, 112),
            word("место", 1, 10, 300),
            word("место", 1, 10, 512),
        ]

        summary, pairs = MODULE.compare_word_movement(reference, candidate)

        self.assertEqual([pair["distancePt"] for pair in pairs], [12, 12])
        self.assertEqual(summary["extraWordCount"], 2)

    def test_deleted_word_is_not_classified_as_movement(self) -> None:
        reference = [word("kept", 1, 10, 10), word("deleted", 1, 40, 10)]
        candidate = [word("kept", 1, 10, 10)]

        summary, _ = MODULE.compare_word_movement(reference, candidate)

        self.assertEqual(summary["severity"], "equal")
        self.assertEqual(summary["missingWordCount"], 1)
        self.assertEqual(summary["extraWordCount"], 0)

    def test_word_center_ignores_equal_font_width_growth(self) -> None:
        reference = [word("alpha", 1, 10, 10, 20)]
        candidate = [word("alpha", 1, 8, 10, 24)]

        summary, pairs = MODULE.compare_word_movement(reference, candidate)

        self.assertEqual(summary["severity"], "equal")
        self.assertEqual(pairs[0]["distancePt"], 0)


class PhysicalGlyphExtractionTests(unittest.TestCase):
    def test_line_actual_text_does_not_collapse_word_geometry(self):
        import pymupdf
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "actual-text.pdf"
            document = pymupdf.open()
            page = document.new_page()
            page.insert_text((72, 72), "two words")
            stream = page.get_contents()[0]
            content = document.xref_stream(stream)
            document.update_stream(stream, b"/Span << /ActualText (two words) >> BDC\n" + content + b"\nEMC")
            document.save(path)
            document.close()
            words = MODULE.extract_words(path, 100, 100, 10000, 10, "mupdf")
            self.assertEqual([word["text"] for word in words], ["two", "words"])
            self.assertLess(words[0]["x1"], words[1]["x0"])
            with self.assertRaises(RuntimeError):
                MODULE.extract_words(path, 1, 1, 10000, 10, "mupdf")


if __name__ == "__main__":
    unittest.main()
