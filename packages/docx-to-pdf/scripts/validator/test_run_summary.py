# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog import run_summary
from server import main


class RunSummaryTests(unittest.TestCase):
    def document(self):
        return dict(id='a' * 64, status='exported', source='source.docx', sourceSha256='a' * 64,
                    engineSha256='engine', scorerSha256='scorer', fonts=['missing-family'],
                    referenceMode='saved', pdfs={'reference-a': dict(path='reference.pdf', sha256='reference'),
                                                'ours': dict(path='ours.pdf', sha256='native')},
                    resources={'native': dict(elapsedSeconds=2, peakRssBytes=1024),
                               'reference-a--ours': dict(reused=True)}, comparisons={
                        'reference-a--ours': dict(errorPercent=.5, leftPages=4, rightPages=4,
                            pageCountMismatch=False, sizeMismatch=False, firstDivergence=dict(page=2, topPt=24),
                            baseline=dict(errorPercent=.6, deltaPercentagePoints=-.1,
                                          firstDivergence=dict(page=1, topPt=10)),
                            pages=[dict(number=i, errorPercent=3 if i == 4 else .2,
                                        images={'diff': f'page-{i}.png'}, bands=[[24, 30]]) for i in range(1, 5)],
                            text=dict(pageDrift=[dict(page=i) for i in range(1, 5)],
                                      earliestMovements=[dict(text=str(i)) for i in range(100)]))})

    def test_compact_context_does_not_hide_later_failure_or_change_evidence(self):
        document = self.document(); before = copy.deepcopy(document)
        root = Path('/local/evidence')
        result = run_summary(document, root, 3.5)
        comparison = result['comparisons']['reference-a--ours']
        self.assertEqual(comparison['verdict'], 'fail')
        self.assertIn('At least one page has 1% or greater pixel difference', comparison['reasons'])
        self.assertEqual(comparison['worstPage'], dict(number=4, errorPercent=3))
        self.assertEqual([page['number'] for page in comparison['inspectPages']], [1, 2])
        self.assertEqual(comparison['inspectPages'][0]['images']['diff'], '/local/evidence/page-1.png')
        self.assertEqual(comparison['text']['pageDrift'], [dict(page=1), dict(page=2)])
        self.assertEqual(len(comparison['text']['earliestMovements']), 6)
        self.assertEqual(comparison['baseline']['firstDivergence'], dict(page=1, topPt=10))
        self.assertEqual(result['timing'], dict(elapsedSeconds=3.5, measuredStagesSeconds=2, otherSeconds=1.5))
        self.assertTrue(result['resources']['reference-a--ours']['reused'])
        self.assertEqual(result['pdfs']['reference-a']['sha256'], 'reference')
        self.assertEqual(result['source'], '/local/evidence/source.docx')
        self.assertEqual(result['fonts'], ['missing-family'])
        self.assertEqual(document, before)

    def test_missing_pages_and_dimensions_are_not_hidden_by_small_pixel_error(self):
        for mismatch in ('pageCountMismatch', 'sizeMismatch'):
            document = self.document(); comparison = document['comparisons']['reference-a--ours']
            comparison.update(errorPercent=0, pages=[], firstDivergence=None, **{mismatch: True})
            compact = run_summary(document, Path('/local'))['comparisons']['reference-a--ours']
            self.assertEqual(compact['verdict'], 'fail')
            self.assertTrue(compact[mismatch])
            self.assertEqual(compact['inspectPages'], [])
        document.update(status='error', message='No valid saved reference', comparisons={}, pdfs={'ours': document['pdfs']['ours']})
        failed = run_summary(document, Path('/local'))
        self.assertEqual(failed['status'], 'error')
        self.assertEqual(failed['message'], 'No valid saved reference')
        self.assertEqual(failed['comparisons'], {})

    def test_cli_summary_runs_pipeline_once_and_preserves_failure_exit(self):
        for status in ('exported', 'error'):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve(); source = root / 'source.docx'; source.write_bytes(b'fixture')
                document = self.document(); document['status'] = status
                output = io.StringIO()
                with patch('sys.argv', ['validator', '--data', temp, '--once', str(source), '--reuse-references', '--summary']), \
                     patch('pipeline.Worker') as worker, patch('sys.stdout', output), \
                     patch('tempfile.gettempdir', return_value=temp):
                    worker.return_value.process.return_value = document
                    if status == 'error':
                        with self.assertRaises(SystemExit) as raised:
                            main()
                        self.assertEqual(raised.exception.code, 1)
                    else:
                        main()
                    worker.return_value.process.assert_called_once_with(source, {}, reuse_references=True)
                result = json.loads(output.getvalue())
                self.assertEqual(result['status'], status)
                self.assertEqual(result['evidence'], str(root / 'documents' / document['id'] / 'document.json'))
                self.assertNotIn('pages', result['comparisons']['reference-a--ours'])
                if status == 'error':
                    self.assertEqual(result['comparisons']['reference-a--ours']['verdict'], 'unscored')

    def test_summary_requires_a_single_run(self):
        with patch('sys.argv', ['validator', '--report', '--summary']), patch('sys.stderr', io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                main()
            self.assertEqual(raised.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
