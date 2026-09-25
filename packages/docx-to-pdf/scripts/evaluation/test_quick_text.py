# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import unittest

from quick_text import compare, from_measurement, index_pages


class QuickTextTests(unittest.TestCase):
    def test_shift_does_not_become_missing_content(self):
        value = compare(
            index_pages([["a", "b"], ["c", "d"]]),
            index_pages([["a"], ["b", "c"], ["d"]]),
        )
        self.assertEqual(value["minimumMovedWords"], 2)
        self.assertEqual(value["missingWords"], 0)
        self.assertEqual(value["extraWords"], 0)
        self.assertEqual(value["absolutePageError"], 1)

    def test_repeated_words_preserve_multiplicity(self):
        value = compare(index_pages([["x", "x"], ["y"]]), index_pages([["x"], ["x", "y", "y"]]))
        self.assertEqual(value["minimumMovedWords"], 1)
        self.assertEqual(value["extraWords"], 1)
        self.assertEqual(value["missingWords"], 0)

    def test_order_difference_is_not_an_exact_pass(self):
        value = compare(index_pages([["a", "b"]]), index_pages([["b", "a"]]))
        self.assertEqual(value["minimumMovedWords"], 0)
        self.assertEqual(value["mainIssue"], "word-order")
        self.assertEqual(value["exactTextPages"], 0)

    def test_blank_pages_and_unicode(self):
        value = compare(index_pages([["e\u0301", "שלום"], []]), index_pages([["é", "שלום"]]))
        self.assertEqual(value["missingWords"], 0)
        self.assertEqual(value["absolutePageError"], 1)
        self.assertEqual(value["differentTextPages"], 1)

    def test_measurement_conversion_preserves_page_assignment(self):
        value = from_measurement({"pages": [{}, {}], "words": [{"page": 2, "text": "word"}]})
        self.assertEqual(value["pages"], [[], [0]])
        with self.assertRaises(ValueError):
            from_measurement({"pages": [{}], "words": [{"page": 0, "text": "word"}]})

    def test_identical_and_empty_text(self):
        value = compare(index_pages([[], ["a"]]), index_pages([[], ["a"]]))
        self.assertEqual(value["mainIssue"], "none")
        self.assertEqual(value["exactTextPages"], 2)

    def test_invalid_cached_index_refused(self):
        bad = index_pages([["a"]])
        bad["pages"][0][0] = -1
        with self.assertRaises(ValueError):
            compare(bad, index_pages([["a"]]))


class PdfIndexTests(unittest.TestCase):
    def test_pdf_index_never_renders_pixels(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        import pymupdf
        from quick_text import measure_pdf

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "synthetic.pdf"
            with pymupdf.open() as doc:
                doc.new_page().insert_text((72, 72), "alpha alpha beta")
                doc.new_page()
                doc.save(path)
            with patch.object(
                pymupdf.Page,
                "get_pixmap",
                side_effect=AssertionError("Unexpected rasterization"),
            ):
                measured = measure_pdf(path)
            self.assertEqual(measured["words"], 3)
            self.assertEqual(len(measured["pages"]), 2)
            self.assertEqual(compare(measured, measured)["exactTextPages"], 2)


class RepeatedPageBoundaryTests(unittest.TestCase):
    def test_repeated_label_crossing_page_boundary_is_not_missing(self):
        value = compare(index_pages([["x", "x"], ["x"]]), index_pages([["x", "x", "x"], []]))
        self.assertEqual(value["minimumMovedWords"], 1)
        self.assertEqual(value["missingWords"], 0)
        self.assertEqual(value["extraWords"], 0)


class LayoutTextTests(unittest.TestCase):
    def test_layout_reports_moved_words_and_source_locations(self):
        from quick_text import compare_layout

        summary = {
            "pageCount": 2,
            "text": {
                "version": "layout-text-v1",
                "pages": [
                    {
                        "lines": [
                            {
                                "text": "alpha beta",
                                "story": "body",
                                "paragraphId": "p1",
                                "spans": [
                                    {
                                        "text": "alpha beta",
                                        "sourceRange": {"paragraphId": "p1", "start": 0, "end": 10},
                                        "box": {"x": 20, "y": 30, "width": 60, "height": 12},
                                    }
                                ],
                            }
                        ]
                    },
                    {"lines": []},
                ],
            },
        }
        result = compare_layout(index_pages([["alpha"], ["beta"]]), summary)
        self.assertEqual(result["minimumMovedWords"], 1)
        self.assertEqual(result["missingWords"], 0)
        self.assertEqual(result["scope"], "layout-text-screen")
        self.assertEqual(result["firstDifferences"][0]["candidateUnmatchedSample"], ["beta"])
        self.assertEqual(result["firstDifferences"][0]["candidateLocations"][0]["paragraphId"], "p1")


class RepeatedLocationTests(unittest.TestCase):
    def test_unmatched_duplicate_does_not_point_at_matched_line(self):
        from quick_text import compare_layout

        lines = [
            {
                "text": "same",
                "story": "body",
                "paragraphId": name,
                "spans": [{"text": "same", "sourceRange": None, "box": {"x": 0, "y": i}}],
            }
            for i, name in enumerate(["matched", "extra"])
        ]
        value = compare_layout(
            index_pages([["same"]]),
            {"pageCount": 1, "text": {"version": "layout-text-v1", "pages": [{"lines": lines}]}},
        )
        self.assertEqual(value["firstDifferences"][0]["candidateLocations"][0]["paragraphId"], "extra")
        self.assertEqual(value["firstDifferences"][0]["locationStatus"], "occurrence-ambiguous")


if __name__ == "__main__":
    unittest.main()
