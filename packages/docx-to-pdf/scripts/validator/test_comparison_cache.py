# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog import write_json
from evidence import copy_comparison, digest
from pipeline import Worker


class ComparisonCacheTests(unittest.TestCase):
    def test_engine_reruns_reuse_only_complete_unchanged_reference_pairs(self):
        for changed in ('engine', 'scorer', 'pdf', 'preview', 'pages', 'invalid'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve(); source = root / 'input.docx'; source.write_bytes(b'fixture')
                identity = digest(source); destination = root / 'documents' / identity
                old = destination / 'runs' / 'old'; old.mkdir(parents=True)
                pdfs = {}
                for key in ('reference-a', 'reference-b'):
                    path = old / f'{key}.pdf'; path.write_bytes(key.encode())
                    pdfs[key] = dict(path=path.relative_to(root).as_posix(), sha256=digest(path))
                images = {}
                for role in ('left', 'right', 'diff', 'overlay'):
                    path = old / f'{role}.png'; path.write_bytes(b'preview')
                    images[role] = path.relative_to(root).as_posix()
                metrics = dict(left='reference-a', right='reference-b', leftPages=1, rightPages=1,
                               errorPercent=2, dpi=96, threshold=28,
                               pages=[dict(number=1, errorPercent=2, images=images)])
                if changed == 'preview':
                    (root / images['diff']).unlink()
                if changed == 'pages':
                    metrics['leftPages'] = 2
                if changed == 'invalid':
                    metrics['invalidEvidence'] = True
                write_json(destination / 'document.json', dict(id=identity, status='exported',
                           engineSha256='old-engine', scorerSha256='old-scorer' if changed == 'scorer' else 'scorer',
                           pdfs=pdfs, comparisons={'reference-a--reference-b': metrics}))
                stages = []
                def stage(command, log, *_args, **_kwargs):
                    stages.append(log.stem)
                    if log.stem == 'native':
                        Path(command[-1]).write_bytes(b'native')
                        log.write_text(json.dumps(dict(status='exported', pages=1, fontResolution={})))
                    elif log.stem == 'reference':
                        Path(command[-1]).write_bytes(b'changed-reference')
                    return {}
                def compare(report, left, right, *_args):
                    report.parent.mkdir(parents=True)
                    return dict(left=left, right=right, leftPages=1, rightPages=1,
                                errorPercent=3, dpi=96, threshold=28, pages=[])
                settings = dict(referenceCommand=['adapter', '{input}', '{output}'])
                with patch('pipeline.run_owned', side_effect=stage), \
                     patch('pipeline.comparison', side_effect=compare), \
                     patch('pipeline.comparison_identity', return_value='scorer'), \
                     patch('pipeline.engine_identity', return_value='new-engine'):
                    result = Worker(root).process(source, settings, reuse_references=changed != 'pdf')
                self.assertEqual(result['status'], 'exported', result.get('message'))
                self.assertFalse(old.exists())
                self.assertIn('reference-a--ours', stages)
                self.assertIn('reference-b--ours', stages)
                pair = 'reference-a--reference-b'
                if changed == 'engine':
                    self.assertNotIn(pair, stages)
                    self.assertTrue(result['resources'][pair]['reused'])
                    self.assertEqual(result['comparisons'][pair]['errorPercent'], 2)
                    for relative in result['comparisons'][pair]['pages'][0]['images'].values():
                        self.assertEqual((root / relative).read_bytes(), b'preview')
                        self.assertIn(result['run'], relative)
                else:
                    self.assertIn(pair, stages)
                    self.assertEqual(result['comparisons'][pair]['errorPercent'], 3)

    def test_unchanged_native_reuses_evidence_but_still_exports_and_updates_baseline(self):
        for changed in ('engine', 'native', 'reference', 'scorer', 'invalid'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve(); source = root / 'input.docx'; source.write_bytes(b'fixture')
                destination = root / 'documents' / digest(source)
                old = destination / 'runs' / 'old'; old.mkdir(parents=True)
                pdfs = {}
                for key, content in [('reference-b', b'reference'), ('ours', b'old' if changed == 'native' else b'native')]:
                    path = old / f'{key}.pdf'; path.write_bytes(content)
                    pdfs[key] = dict(path=path.relative_to(root).as_posix(), sha256=digest(path))
                preview = old / 'preview.png'; preview.write_bytes(b'preview')
                pair = 'reference-b--ours'
                metrics = dict(left='reference-b', right='ours', leftPages=1, rightPages=1,
                               errorPercent=2, dpi=96, threshold=28, invalidEvidence=changed == 'invalid',
                               baseline=dict(engineSha256='stale', deltaPercentagePoints=-5),
                               pages=[dict(number=1, errorPercent=2, images={role: preview.relative_to(root).as_posix()
                                      for role in ('left', 'right', 'diff', 'overlay')})])
                write_json(destination / 'document.json', dict(status='exported', engineSha256='previous-engine',
                           scorerSha256='old' if changed == 'scorer' else 'scorer', pdfs=pdfs, comparisons={pair: metrics}))
                stages = []
                def stage(command, log, *_args, **_kwargs):
                    stages.append(log.stem)
                    if log.stem == 'native':
                        Path(command[-1]).write_bytes(b'native')
                        log.write_text(json.dumps(dict(status='exported', pages=1, fontResolution={})))
                    elif log.stem == 'reference':
                        Path(command[-1]).write_bytes(b'new-reference')
                    return {}
                def compare(report, left, right, *_args):
                    report.parent.mkdir(parents=True)
                    return dict(left=left, right=right, leftPages=1, rightPages=1, errorPercent=3,
                                dpi=96, threshold=28, pages=[])
                with patch('pipeline.run_owned', side_effect=stage), \
                     patch('pipeline.comparison', side_effect=compare), \
                     patch('pipeline.engine_identity', return_value='new-engine'), \
                     patch('pipeline.comparison_identity', return_value='scorer'):
                    result = Worker(root).process(source, dict(referenceCommand=['adapter', '{input}', '{output}']),
                                                  reuse_references=changed != 'reference')
                self.assertEqual(result['status'], 'exported', result.get('message'))
                self.assertIn('native', stages)
                self.assertFalse(old.exists())
                if changed == 'engine':
                    self.assertNotIn(pair, stages)
                    self.assertTrue(result['resources'][pair]['reused'])
                    current = result['comparisons'][pair]
                    self.assertEqual(current['baseline']['engineSha256'], 'previous-engine')
                    self.assertEqual(current['baseline']['deltaPercentagePoints'], 0)
                    for relative in current['pages'][0]['images'].values():
                        self.assertEqual((root / relative).read_bytes(), b'preview')
                else:
                    self.assertIn(pair, stages)
                    self.assertEqual(result['comparisons'][pair]['errorPercent'], 3)
                    if changed in ('reference', 'scorer', 'invalid'):
                        self.assertNotIn('baseline', result['comparisons'][pair])

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
