# Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import copy
import tempfile
import unittest
from pathlib import Path

from catalog import catalog, check_disk_budget, run_summary, score, triage, write_json
from evidence import comparison, set_pdf


class ScoringTests(unittest.TestCase):
    def test_replacing_reference_invalidates_only_affected_scores(self):
        doc = dict(pdfs={'reference-b': {'sha256': 'old'}}, comparisons={
            'a-native': dict(left='reference-a', right='ours'),
            'b-native': dict(left='reference-b', right='ours'),
            'a-b': dict(left='reference-a', right='reference-b')})
        set_pdf(doc, 'reference-b', dict(sha256='new'))
        self.assertEqual(list(doc['comparisons']), ['a-native'])

    def test_inbox_counts_toward_disk_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json(root / 'settings.json', dict(maxDataMiB=1))
            (root / 'inbox').mkdir()
            (root / 'inbox/large.docx').write_bytes(bytes(1024 * 1024))
            with self.assertRaises(RuntimeError):
                check_disk_budget(root, extra_bytes=1)

    def test_blank_missing_page_never_passes(self):
        self.assertEqual(score(dict(errorPercent=0, pageCountMismatch=True))['verdict'], 'fail')

    def test_local_failure_cannot_hide_in_document_average(self):
        self.assertEqual(score(dict(errorPercent=.02, pages=[dict(errorPercent=5)]))['verdict'], 'fail')

    def test_strict_boundary_and_invalid_measurements(self):
        for error in (None, float('nan'), float('inf'), -1, 101, True):
            self.assertEqual(score(dict(errorPercent=error))['verdict'], 'unscored')
        self.assertEqual(score(dict(errorPercent=1))['verdict'], 'fail')
        self.assertEqual(score(dict(errorPercent=.999))['verdict'], 'pass')
        self.assertEqual(score(dict(errorPercent=0, invalidEvidence=True))['verdict'], 'fail')

    def test_first_divergence_precedes_largest_error_and_regions_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / 'image.png'; image.write_bytes(b'fixture')
            pages = []
            for error, top in [(0.0001, 12), (0.002, 30), (0.2, 600)]:
                pages.append(dict(changedFractionByThreshold={'28': error}, referencePresent=True,
                                  candidatePresent=True, sizeMismatch=False, strongDifferenceBoundsPt=[10, top, 500, 700],
                                  strongDifferenceBandsPt=[[top, top + 4]],
                                  artifacts={key: str(image) for key in ('reference', 'candidate', 'amplified', 'strongOverlay')}))
            report = root / 'report.json'
            write_json(report, dict(strongThreshold=28, dpi=96, referencePages=3, candidatePages=3,
                                    pageCountMismatch=False, changedFractionByThreshold={'28': .05}, pages=pages))
            result = comparison(report, 'reference-a', 'ours', root / 'images', root)
            self.assertEqual(result['firstDivergence'], dict(page=2, topPt=30))
            self.assertEqual(result['pages'][1]['bands'], [[30, 34]])

    def test_catalog_refresh_and_agent_order(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, page in [('a', 20), ('b', 1)]:
                identity = name * 64
                write_json(root / 'documents' / identity / 'document.json',
                           dict(id=identity, name=name, status='exported', comparisons={
                               'reference-a--ours': dict(errorPercent=5, firstDivergence=dict(page=page, topPt=30))}))
            self.assertEqual(triage(root)['issues'][0]['name'], 'b')
            path = root / 'documents' / ('a' * 64) / 'document.json'
            path.write_text('{')
            self.assertEqual(len(catalog(root)['warnings']), 1)
            self.assertEqual(len(catalog(root)['documents']), 1)


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


if __name__ == '__main__':
    unittest.main()
