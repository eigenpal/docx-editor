#!/usr/bin/env python3
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


@unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm"), "Poppler is required")
class PdfVisualDiffTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
