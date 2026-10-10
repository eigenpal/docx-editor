# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline import engine_identity


class EngineIdentityTests(unittest.TestCase):
    def test_runtime_and_dependencies_invalidate_but_tests_do_not(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for package in ('core', 'fonts', 'docx-to-pdf'):
                base = root / 'packages' / package
                (base / 'src').mkdir(parents=True)
                for name in ('package.json', 'tsconfig.json', 'src/index.ts'):
                    (base / name).write_text(name)
            (root / 'bun.lock').write_text('lock')
            scripts = root / 'scripts'; scripts.mkdir()
            for name in ('benchmark-export.ts', 'pdf-visual-diff.py'):
                (scripts / name).write_text(name)
            with patch('pipeline.REPO', root), patch('pipeline.SCRIPTS', scripts):
                initial = engine_identity()
                source = root / 'packages' / 'core' / 'src'
                for name in ('__tests__/fixtures/document.xml', 'layout.test.ts', 'layout.spec.tsx'):
                    path = source / name; path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('test fixture'); self.assertEqual(engine_identity(), initial)
                    path.write_text('edited fixture'); self.assertEqual(engine_identity(), initial)
                    path.unlink(); self.assertEqual(engine_identity(), initial)
                for path in (source / 'index.ts', source / 'new.ts', root / 'bun.lock',
                             root / 'packages/fonts/package.json', scripts / 'pdf-visual-diff.py'):
                    previous = path.read_bytes() if path.exists() else None
                    path.write_bytes(b'changed'); self.assertNotEqual(engine_identity(), initial)
                    if previous is None: path.unlink()
                    else: path.write_bytes(previous)
                    self.assertEqual(engine_identity(), initial)


if __name__ == '__main__':
    unittest.main()
