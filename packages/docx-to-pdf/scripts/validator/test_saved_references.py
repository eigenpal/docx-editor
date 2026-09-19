# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import json
import io
import fcntl
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog import write_json
from evidence import comparison_identity, digest
from pipeline import Worker
from server import main


class SavedReferenceTests(unittest.TestCase):
    def test_archived_reruns_keep_names_and_external_uploads_can_rename(self):
        for managed in (True, False):
            with self.subTest(managed=managed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                upload = root / ('upload-' + 'a' * 32 + '--new-name.docx')
                upload.write_bytes(b'fixture')
                identity = digest(upload); destination = root / 'documents' / identity
                archived = destination / 'runs' / 'old-run' / 'source.docx'
                archived.parent.mkdir(parents=True); archived.write_bytes(upload.read_bytes())
                write_json(destination / 'document.json', dict(id=identity, name='original-name.docx'))
                source = archived if managed else upload
                def stage(_command, log, *_args, **_kwargs):
                    log.write_text(json.dumps(dict(status='unsupported', error='fixture', fontResolution={})))
                    return {}
                with patch('pipeline.run_owned', side_effect=stage), patch('pipeline.engine_identity', return_value='stable'):
                    result = Worker(root).process(source, {}, reuse_references=True)
                expected = 'original-name.docx' if managed else 'new-name.docx'
                self.assertEqual(result['name'], expected)
                self.assertEqual(json.loads((destination / 'document.json').read_text())['name'], expected)
                self.assertEqual(digest(root / result['source']), identity)

    def test_cli_reports_failure_to_automation_and_releases_lock(self):
        for status in ('error', 'unsupported', 'exported'):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                source = root / 'input.docx'; source.write_bytes(b'fixture')
                result = dict(status=status, comparisons={})
                output = io.StringIO()
                with patch('sys.argv', ['validator', '--data', temp, '--once', str(source), '--reuse-references']), \
                     patch('pipeline.Worker') as worker, patch('sys.stdout', output), \
                     patch('tempfile.gettempdir', return_value=temp):
                    worker.return_value.process.return_value = result
                    if status == 'exported':
                        main()
                    else:
                        with self.assertRaises(SystemExit) as raised:
                            main()
                        self.assertEqual(raised.exception.code, 1)
                    worker.return_value.process.assert_called_once_with(source, {}, reuse_references=True)
                self.assertEqual(json.loads(output.getvalue())['status'], status)
                with (root / f'pdf-validation-{os.getuid()}.lock').open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_rerun_needs_no_adapter_and_records_comparable_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source = root / 'input.docx'; source.write_bytes(b'fixture')
            identity = digest(source); destination = root / 'documents' / identity
            destination.mkdir(parents=True); reference = destination / 'reference.pdf'; reference.write_bytes(b'reference')
            write_json(destination / 'document.json', dict(id=identity, status='exported', engineSha256='old-engine',
                       scorerSha256=comparison_identity(),
                       pdfs={'reference-a': dict(path=reference.relative_to(root).as_posix(), sha256=digest(reference))},
                       comparisons={'reference-a--ours': dict(errorPercent=10, dpi=96, threshold=28,
                           firstDivergence=dict(page=2, topPt=30), sizeMismatch=True,
                           pages=[dict(number=1, errorPercent=0), dict(number=2, errorPercent=20)])}))
            stages = []
            def stage(command, log, *_args, **_kwargs):
                stages.append(command)
                if log.name == 'native.log':
                    Path(command[-1]).write_bytes(b'native')
                    log.write_text(json.dumps(dict(status='exported', pages=1, fontResolution={})))
                return dict(peakRssBytes=123)
            metrics = dict(left='reference-a', right='ours', leftPages=1, rightPages=1,
                           errorPercent=2, dpi=96, threshold=28, pages=[])
            def compare(report, *_args):
                report.parent.mkdir(parents=True)
                return metrics.copy()
            with patch('pipeline.run_owned', side_effect=stage), patch('pipeline.comparison', side_effect=compare), patch('pipeline.engine_identity', return_value='new-engine'):
                result = Worker(root).process(source, {}, reuse_references=True)
            self.assertEqual(result['status'], 'exported', result.get('message'))
            self.assertEqual(len(stages), 2)
            self.assertEqual(result['referenceMode'], 'saved')
            baseline = result['comparisons']['reference-a--ours']['baseline']
            self.assertEqual(baseline['deltaPercentagePoints'], -8)
            self.assertEqual(baseline['engineSha256'], 'old-engine')
            self.assertEqual(baseline['firstDivergence'], dict(page=2, topPt=30))
            self.assertEqual(baseline['worstPageError'], 20)
            self.assertTrue(baseline['sizeMismatch'])
            self.assertEqual(digest(root / result['pdfs']['reference-a']['path']), digest(reference))

    def test_missing_saved_reference_cannot_be_scored_as_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source = root / 'input.docx'; source.write_bytes(b'fixture')
            def stage(command, log, *_args, **_kwargs):
                Path(command[-1]).write_bytes(b'native')
                log.write_text(json.dumps(dict(status='exported', pages=1, fontResolution={})))
                return {}
            with patch('pipeline.run_owned', side_effect=stage), patch('pipeline.engine_identity', return_value='stable'):
                result = Worker(root).process(source, {}, reuse_references=True)
            self.assertEqual(result['status'], 'error')
            self.assertIn('No valid saved reference', result['message'])
            self.assertEqual(result['comparisons'], {})


if __name__ == '__main__':
    unittest.main()
