# Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from evidence import copy_comparison


class ComparisonCacheTests(unittest.TestCase):
    def test_bad_cache_falls_back_but_disk_budget_stops_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); image = root / 'image.png'; image.write_bytes(b'image')
            metrics = dict(left='reference-a', right='reference-b', leftPages=1, rightPages=1,
                           dpi=96, threshold=28, pages=[dict(number=1, images={
                               role: 'image.png' for role in ('left', 'right', 'diff', 'overlay')})])
            output = root / 'new'
            for invalid in (None, {}, {**metrics, 'pages': [None]}, {**metrics, 'dpi': 144}):
                self.assertIsNone(copy_comparison(invalid, 'reference-a', 'reference-b', output, root))
            with patch('evidence.check_disk_budget', side_effect=RuntimeError('budget')):
                with self.assertRaisesRegex(RuntimeError, 'budget'):
                    copy_comparison(metrics, 'reference-a', 'reference-b', output, root)
            self.assertFalse(output.exists())
            image.unlink(); image.symlink_to('/etc/hosts')
            self.assertIsNone(copy_comparison(metrics, 'reference-a', 'reference-b', output, root))


if __name__ == '__main__':
    unittest.main()
