#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""A benchmark must detect source changes even when inputs remain unchanged."""
from pathlib import Path
import tempfile
import unittest
from benchmark import engine_code_hash


class BenchmarkHashTest(unittest.TestCase):
    def test_changes_additions_and_removals_are_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'packages/core/src/layout.ts'
            source.parent.mkdir(parents=True)
            source.write_text('before')
            before = engine_code_hash(root)
            self.assertEqual(before, engine_code_hash(root))
            source.write_text('after')
            changed = engine_code_hash(root)
            self.assertNotEqual(before, changed)
            added = source.with_name('new.ts')
            added.write_text('new implementation')
            self.assertNotEqual(changed, engine_code_hash(root))
            added.unlink()
            self.assertEqual(changed, engine_code_hash(root))
            source.unlink()
            self.assertNotEqual(changed, engine_code_hash(root))

    def test_outputs_outside_engine_paths_do_not_invalidate_a_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = engine_code_hash(root)
            (root / 'report.json').write_text('{}')
            self.assertEqual(before, engine_code_hash(root))


if __name__ == '__main__':
    unittest.main()
