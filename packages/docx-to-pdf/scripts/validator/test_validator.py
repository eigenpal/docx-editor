# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from catalog import catalog, check_disk_budget, score, triage, write_json
from evidence import comparison, set_pdf
from processes import run_owned
from server import handler_for
from pipeline import Worker


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


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.worker = type('WorkerStub', (), {'state': dict(status='idle', queue=[])})()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.root, self.worker))
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def test_paths_and_symlinks_cannot_escape_data_root(self):
        with tempfile.TemporaryDirectory() as outside:
            secret = Path(outside) / 'secret.pdf'; secret.write_bytes(b'secret')
            (self.root / 'escape.pdf').symlink_to(secret)
            for route in ['/assets/escape.pdf', '/assets/../server.py', '/assets/%2e%2e/server.py', '/assets//etc/passwd']:
                with self.assertRaises(HTTPError) as raised:
                    urlopen(self.url + route)
                self.assertEqual(raised.exception.code, 404)

    def test_pdf_ranges_and_head(self):
        (self.root / 'test.pdf').write_bytes(b'0123456789')
        with urlopen(Request(self.url + '/assets/test.pdf', headers={'Range': 'bytes=2-5'})) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), b'2345')
        with urlopen(Request(self.url + '/assets/test.pdf', method='HEAD')) as response:
            self.assertEqual(response.headers['Content-Length'], '10')
            self.assertEqual(response.read(), b'')
        with self.assertRaises(HTTPError) as raised:
            urlopen(Request(self.url + '/assets/test.pdf', headers={'Range': 'bytes=20-30'}))
        self.assertEqual(raised.exception.code, 416)

    def test_rejects_external_origin_host_and_large_upload(self):
        for headers, body in [({'Host': 'external.example'}, None),
                              ({'Origin': 'https://external.example', 'X-Filename': 'x.docx'}, b'x'),
                              ({'Origin': self.url, 'X-Filename': 'x.docx', 'Content-Length': str(21 * 1024 * 1024)}, b'x')]:
            with self.assertRaises(HTTPError) as raised:
                urlopen(Request(self.url + ('/api/inbox' if body else '/api/catalog'), headers=headers, data=body))
            self.assertIn(raised.exception.code, (403, 413))

    def test_upload_does_not_overwrite_existing_file(self):
        for _ in range(2):
            with urlopen(Request(self.url + '/api/inbox', headers={'Origin': self.url, 'X-Filename': 'same.docx'}, data=b'docx')) as response:
                self.assertIn('queued', json.load(response))
        self.assertEqual(len(list((self.root / 'inbox').glob('*.docx'))), 2)
        self.assertFalse(list((self.root / 'inbox').glob('*.upload')))


class ProcessTests(unittest.TestCase):
    def test_success_reaps_surviving_descendant(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = root / 'survived'
            child = f'import time; from pathlib import Path; time.sleep(1.5); Path({str(marker)!r}).touch()'
            parent = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); time.sleep(.4)'
            run_owned([sys.executable, '-c', parent], root / 'stage.log', threading.Event())
            time.sleep(1.2)
            self.assertFalse(marker.exists())

    def test_disk_guard_cancels_stage_and_preserves_resource_evidence(self):
        def full():
            raise RuntimeError('Disk budget reached')
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(RuntimeError) as raised:
                run_owned([sys.executable, '-c', 'import time; time.sleep(30)'], Path(temp) / 'stage.log',
                          threading.Event(), disk_guard=full)
            self.assertIn('peakRssBytes', raised.exception.resources)

    def test_timeout_reaps_children_without_touching_unrelated_process(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = root / 'escaped'
            child = f'import time; from pathlib import Path; time.sleep(1.5); Path({str(marker)!r}).touch()'
            parent = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}],start_new_session=True); time.sleep(30)'
            unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
            try:
                with self.assertRaises(TimeoutError):
                    run_owned([sys.executable, '-c', parent], root / 'stage.log', threading.Event(), timeout=.5)
                time.sleep(1.1)
                self.assertFalse(marker.exists())
                self.assertIsNone(unrelated.poll())
            finally:
                unrelated.kill(); unrelated.wait()

    def test_memory_limit_stops_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(MemoryError):
                run_owned([sys.executable, '-c', 'import time; x=bytearray(80*1024*1024); time.sleep(30)'],
                          Path(temp) / 'stage.log', threading.Event(), timeout=10, max_rss_mb=40)

    def test_cancellation_reaps_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            stop = threading.Event()
            timer = threading.Timer(.3, stop.set); timer.start()
            try:
                with self.assertRaises(InterruptedError):
                    run_owned([sys.executable, '-c', 'import time; time.sleep(30)'], Path(temp) / 'stage.log', stop)
            finally:
                timer.join()

    def test_second_worker_cannot_launch_converters(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Worker(Path(temp) / 'one'), Worker(Path(temp) / 'two')
            with patch('pipeline.tempfile.gettempdir', return_value=temp):
                try:
                    first.start()
                    with self.assertRaises(RuntimeError):
                        second.start()
                finally:
                    first.close(); second.close()

    def test_queue_is_serial_and_restart_does_not_repeat_completed_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'data'
            write_json(root / 'settings.json', dict(referenceCommand=['test-adapter']))
            (root / 'inbox').mkdir()
            for name in ('a.docx', 'b.docx'):
                (root / 'inbox' / name).write_bytes(b'fixture')
            calls = []
            def process(path, settings):
                calls.append(path.name)
                return dict(status='exported')
            with patch('pipeline.tempfile.gettempdir', return_value=temp):
                first = Worker(root)
                first.process = process
                try:
                    first.start()
                    deadline = time.monotonic() + 5
                    while len(calls) < 2 and time.monotonic() < deadline:
                        time.sleep(.05)
                finally:
                    first.close()
                self.assertEqual(calls, ['a.docx', 'b.docx'])
                second = Worker(root)
                second.process = process
                try:
                    second.start()
                    time.sleep(2.2)
                finally:
                    second.close()
                self.assertEqual(calls, ['a.docx', 'b.docx'])


if __name__ == '__main__':
    unittest.main()
