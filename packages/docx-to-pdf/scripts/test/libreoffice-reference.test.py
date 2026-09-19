#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Private process cleanup and read-only proposed-content reference integration checks."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from zipfile import ZipFile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from libreoffice_reference import convert


@unittest.skipUnless(os.name == 'posix', 'Process-group cleanup is POSIX-specific')
class ReferenceProcessTest(unittest.TestCase):
    def test_timeout_stops_launcher_children(self):
        with tempfile.TemporaryDirectory(prefix='reference-timeout-') as temporary:
            root = Path(temporary)
            source, output = root / 'input.docx', root / 'output.pdf'
            source.write_bytes(b'fixture')
            marker = root / 'child-survived'
            launched = root / 'child-started'
            child = f'from pathlib import Path; import time; Path({str(launched)!r}).touch(); time.sleep(1.5); Path({str(marker)!r}).touch()'
            launcher = root / 'soffice'
            launcher.write_text(f'#!{sys.executable}\nimport subprocess, sys, time\nsubprocess.Popen([sys.executable, "-c", {child!r}])\ntime.sleep(30)\n')
            launcher.chmod(0o755)
            with patch.dict(os.environ, {'PATH': str(root) + os.pathsep + os.environ['PATH']}):
                with self.assertRaises(subprocess.TimeoutExpired):
                    convert(source, output, timeout=0.5)
            self.assertTrue(launched.exists())
            time.sleep(1.6)
            self.assertFalse(marker.exists(), 'Timed-out Writer child kept running')

    def test_interrupt_stops_only_owned_launcher_children(self):
        with tempfile.TemporaryDirectory(prefix='reference-interrupt-') as temporary:
            root = Path(temporary)
            source, output = root / 'input.docx', root / 'output.pdf'
            source.write_bytes(b'fixture')
            launched, survived = root / 'launched', root / 'survived'
            child = f'from pathlib import Path; import time; Path({str(launched)!r}).touch(); time.sleep(1.5); Path({str(survived)!r}).touch()'
            launcher = root / 'soffice'
            launcher.write_text(f'#!{sys.executable}\nimport subprocess, sys, time\nsubprocess.Popen([sys.executable, "-c", {child!r}])\ntime.sleep(30)\n')
            launcher.chmod(0o755)
            communicate = subprocess.Popen.communicate
            interrupted = False
            def interrupt(process, *args, **kwargs):
                nonlocal interrupted
                if not interrupted:
                    interrupted = True
                    deadline = time.monotonic() + 2
                    while not launched.exists() and time.monotonic() < deadline:
                        time.sleep(0.02)
                    raise KeyboardInterrupt()
                return communicate(process, *args, **kwargs)
            unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            try:
                with patch.dict(os.environ, {'PATH': str(root) + os.pathsep + os.environ['PATH']}):
                    with patch.object(subprocess.Popen, 'communicate', interrupt):
                        with self.assertRaises(KeyboardInterrupt):
                            convert(source, output, timeout=5)
                self.assertTrue(launched.exists())
                time.sleep(1.6)
                self.assertFalse(survived.exists(), 'Cancelled Writer child kept running')
                self.assertIsNone(unrelated.poll(), 'Cleanup terminated an unrelated process')
            finally:
                unrelated.kill()
                unrelated.wait()

    def test_success_stops_children_that_closed_their_pipes(self):
        with tempfile.TemporaryDirectory(prefix='reference-success-') as temporary:
            root = Path(temporary)
            source, output = root / 'input.docx', root / 'output.pdf'
            source.write_bytes(b'fixture')
            survived = root / 'survived'
            launcher = root / 'soffice'
            launcher.write_text(f'''#!{sys.executable}
import os, subprocess, sys, time
from pathlib import Path
started = Path({str(root)!r}) / str(os.getpid())
child = 'from pathlib import Path; import time, sys; Path(sys.argv[1]).touch(); time.sleep(1.5); Path(sys.argv[2]).touch()'
subprocess.Popen([sys.executable, '-c', child, str(started), {str(survived)!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
deadline = time.monotonic() + 2
while not started.exists() and time.monotonic() < deadline:
    time.sleep(0.02)
if not started.exists():
    sys.exit(1)
if any(arg.startswith('macro:///') for arg in sys.argv):
    Path({str(output)!r}).write_bytes(b'fake-pdf')
''')
            launcher.chmod(0o755)
            with patch.dict(os.environ, {'PATH': str(root) + os.pathsep + os.environ['PATH']}):
                result = convert(source, output, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), b'fake-pdf')
            time.sleep(1.6)
            self.assertFalse(survived.exists(), 'Successful launcher left a child running')


@unittest.skipUnless(shutil.which('soffice') and shutil.which('pdftotext'), 'Requires LibreOffice and Poppler')
class ReferenceTest(unittest.TestCase):
    def test_proposed_text_without_source_mutation(self):
        with tempfile.TemporaryDirectory(prefix='reference-test-') as temporary:
            root = Path(temporary)
            source, output = root / 'tracked " test.docx', root / 'reference.pdf'
            with ZipFile(source, 'w') as package:
                package.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
                package.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
                package.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Stable </w:t></w:r><w:del w:id="1" w:author="A"><w:r><w:delText>DeletedWord</w:delText></w:r></w:del><w:ins w:id="2" w:author="B"><w:r><w:t>InsertedWord</w:t></w:r></w:ins></w:p></w:body></w:document>')
            original = source.read_bytes()
            convert(source, output)
            text = subprocess.run(['pdftotext', str(output), '-'], check=True, capture_output=True, text=True).stdout
            self.assertIn('Stable', text)
            self.assertIn('InsertedWord', text)
            self.assertNotIn('DeletedWord', text)
            self.assertEqual(source.read_bytes(), original)
            before = output.read_bytes()
            with self.assertRaises(FileExistsError):
                convert(source, output)
            self.assertEqual(output.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
