# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog import write_json
from evidence import digest
from pipeline import Worker


class SavedReferenceTests(unittest.TestCase):
    def test_rerun_needs_no_adapter_and_records_comparable_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source = root / 'input.docx'; source.write_bytes(b'fixture')
            identity = digest(source); destination = root / 'documents' / identity
            destination.mkdir(parents=True); reference = destination / 'reference.pdf'; reference.write_bytes(b'reference')
            write_json(destination / 'document.json', dict(id=identity, status='exported', engineSha256='old-engine',
                       pdfs={'reference-a': dict(path=reference.relative_to(root).as_posix(), sha256=digest(reference))},
                       comparisons={'reference-a--ours': dict(errorPercent=10, dpi=96, threshold=28)}))
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
