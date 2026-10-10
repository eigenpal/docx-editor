# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Serial inbox worker. Captured reference files are reused only by source identity."""
import fcntl
import json
import hashlib
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from catalog import check_disk_budget, read_json, write_json
from evidence import comparison, comparison_identity, copy_comparison, copy_asset, digest, font_substitutions
from processes import run_owned

SCRIPTS = Path(__file__).resolve().parents[1]
REPO = SCRIPTS.parents[2]
MAX_INPUT = 20 * 1024 * 1024


def engine_identity():
    identity = hashlib.sha256()
    for package in ('core', 'fonts', 'docx-to-pdf'):
        for name in ('package.json', 'tsconfig.json'):
            identity.update((REPO / 'packages' / package / name).read_bytes())
        source = REPO / 'packages' / package / 'src'
        for path in sorted(source.rglob('*')):
            relative = path.relative_to(source)
            if '__tests__' in relative.parts or re.search(r'\.(test|spec)\.[cm]?[jt]sx?$', path.name):
                continue
            if path.is_file():
                identity.update(path.relative_to(REPO).as_posix().encode())
                identity.update(path.read_bytes())
    lock = REPO / 'bun.lock'
    identity.update(lock.read_bytes())
    for path in [SCRIPTS / 'benchmark-export.ts', SCRIPTS / 'pdf-visual-diff.py',
                 Path(__file__), Path(__file__).with_name('evidence.py'), Path(__file__).with_name('font_diagnostic.py')]:
        identity.update(path.read_bytes())
    return identity.hexdigest()


class Worker:
    def __init__(self, root):
        self.root = root
        self.stop = threading.Event()
        self.thread = None
        self.state = dict(status='starting', queue=[], current=None)
        self.seen = {}
        self.processed = {}
        self.lock = None

    def start(self):
        # Cross-worktree lock: only one local validator may launch converters at a time.
        lock_path = Path(tempfile.gettempdir()) / f'pdf-validation-{os.getuid()}.lock'
        self.lock = lock_path.open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise RuntimeError('Another validator owns the conversion worker; use --no-watch for viewing')
        (self.root / 'inbox').mkdir(parents=True, exist_ok=True)
        receipts = self.root / 'receipts.json'
        self.processed = read_json(receipts) if receipts.exists() else {}
        self.thread = threading.Thread(target=self.watch, name='pdf-validation-worker', daemon=False)
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join()
        if self.lock and not self.lock.closed:
            self.lock.close()

    def watch(self):
        while not self.stop.is_set():
            try:
                settings_path = self.root / 'settings.json'
                settings = read_json(settings_path) if settings_path.exists() else {}
                command = settings.get('referenceCommand')
                if not command:
                    self.state = dict(status='setup-needed', queue=[], current=None,
                                      message='Set referenceCommand in local settings.json to enable generation.')
                    self.stop.wait(2)
                    continue
                queue = []
                for path in sorted((self.root / 'inbox').iterdir()):
                    if path.is_symlink() or not path.is_file() or path.suffix.lower() != '.docx':
                        continue
                    stat = path.stat()
                    signature = [stat.st_size, stat.st_mtime_ns]
                    if self.seen.get(path.name) == signature and self.processed.get(path.name) != signature:
                        queue.append(path)
                    self.seen[path.name] = signature
                self.state = dict(status='idle', current=None, queue=[p.name for p in queue])
                for index, path in enumerate(queue):
                    if self.stop.is_set():
                        break
                    signature = self.seen[path.name]
                    self.state = dict(status='running', current=path.name,
                                      queue=[p.name for p in queue[index + 1:]])
                    try:
                        result = self.process(path, settings)
                        if result['status'] != 'exported':
                            write_json(self.root / 'last-error.json', dict(file=path.name,
                                       error=result.get('message') or result['status']))
                        else:
                            (self.root / 'last-error.json').unlink(missing_ok=True)
                        self.processed[path.name] = signature
                        write_json(self.root / 'receipts.json', self.processed)
                    except InterruptedError:
                        break
                    except Exception as error:
                        self.processed[path.name] = signature
                        write_json(self.root / 'receipts.json', self.processed)
                        write_json(self.root / 'last-error.json', dict(file=path.name, error=str(error)))
                        self.state = dict(status='error', current=None, queue=[], message=str(error))
                        self.stop.wait(3)
                self.stop.wait(2)
            except Exception as error:
                self.state = dict(status='error', current=None, queue=[], message=str(error))
                self.stop.wait(3)
        self.state = dict(status='stopped', current=None, queue=[])

    def process(self, source, settings, reuse_references=False):
        reference_id = settings.get('generatedReference', 'reference-b')
        if not re.fullmatch(r'reference-[a-z0-9-]+', reference_id):
            raise ValueError('generatedReference must be a neutral ID such as reference-b')
        configured_command = settings.get('referenceCommand')
        if not reuse_references and (not isinstance(configured_command, list) or not configured_command
                or not all(isinstance(arg, str) for arg in configured_command)
                or not any('{input}' in arg for arg in configured_command)
                or not any('{output}' in arg for arg in configured_command)):
            raise ValueError('referenceCommand must be an argument array with {input} and {output}')
        if source.stat().st_size > MAX_INPUT:
            raise ValueError('DOCX exceeds the 20 MiB input limit')
        check_disk_budget(self.root)
        identity = digest(source)
        destination = self.root / 'documents' / identity
        destination.mkdir(parents=True, exist_ok=True)
        previous_path = destination / 'document.json'
        previous = read_json(previous_path) if previous_path.exists() else {}
        run_id = str(time.time_ns()) + '-' + uuid.uuid4().hex[:8]
        run = destination / 'runs' / run_id
        run.mkdir(parents=True)
        display_name = re.sub(r'^upload-[a-f0-9]{32}--', '', source.name)
        # Agent reruns use the archived source.docx; retain its human-facing identity.
        if source.resolve().is_relative_to(destination.resolve()) and isinstance(previous.get('name'), str) and previous['name']:
            display_name = previous['name']
        doc = dict(id=identity, name=display_name, sourceSha256=identity, status='running',
                   comparisons={}, pdfs={}, fonts=[], resources={}, run=run_id)
        doc['source'] = copy_asset(source, run / 'source.docx', self.root)
        if digest(run / 'source.docx') != identity:
            shutil.rmtree(run)
            raise ValueError('Input changed while copying; drop it again after the copy finishes')
        from font_diagnostic import metadata
        doc['diagnostic'] = metadata(run / 'source.docx')
        if doc['diagnostic']:
            doc['name'] = f"[Font diagnostic: {doc['diagnostic']['family']}] {doc['diagnostic'].get('originalName', display_name)}"
        # Keep the last complete result visible while this revision is being generated.
        doc['engineSha256'] = engine_identity()
        doc['scorerSha256'] = comparison_identity()
        # Preserve captured references even if the new native export fails.
        for key, value in previous.get('pdfs', {}).items():
            if key == 'ours' or (key == reference_id and not reuse_references) or not re.fullmatch(r'reference-[a-z0-9-]+', key):
                continue
            old = (self.root / value['path']).resolve()
            if old.is_relative_to(self.root) and old.exists() and digest(old) == value['sha256']:
                doc['pdfs'][key] = {**value, 'path': copy_asset(old, run / f'{key}.pdf', self.root)}
        doc['referenceMode'] = 'saved' if reuse_references else 'generated'
        timeout = min(180, max(5, int(settings.get('timeoutSeconds', 90))))
        memory = min(4096, max(256, int(settings.get('maxRssMiB', 2048))))

        def stage(name, command):
            self.state = {**self.state, 'stage': name}
            try:
                doc['resources'][name] = run_owned(command, run / f'{name}.log', self.stop,
                                                   timeout=timeout, max_rss_mb=memory, cwd=REPO,
                                                   env={'TMPDIR': temporary, 'TMP': temporary, 'TEMP': temporary},
                                                   disk_guard=lambda: check_disk_budget(self.root, temporary=Path(temporary)))
            except BaseException as error:
                doc['resources'][name] = {**getattr(error, 'resources', {}), 'error': str(error)}
                raise

        try:
            # Temporary root is task-owned. Children receive it, so interruption cannot leak profiles.
            with tempfile.TemporaryDirectory(prefix='pdf-validation-') as temporary:
                # This package's source aliases avoid stale dist artifacts and declaration builds.
                stage('native', ['bun', '--tsconfig-override', str(SCRIPTS.parent / 'tsconfig.json'),
                                 str(SCRIPTS / 'benchmark-export.ts'),
                                 str(run / 'source.docx'), str(run / 'ours.pdf')])
                output = (run / 'native.log').read_text()
                native = next(json.loads(line) for line in reversed(output.splitlines()) if line.startswith('{'))
                doc['resources']['native']['reportedPeakRssBytes'] = native.get('peakRssBytes')
                doc.update(status=native['status'], message=native.get('error'),
                           fonts=font_substitutions(native), diagnostics=native.get('diagnostics', []),
                           fontResolution=native.get('fontResolution'))
                if native['status'] != 'exported':
                    write_json(previous_path, doc)
                    return doc
                doc['pdfs']['ours'] = dict(path=(run / 'ours.pdf').relative_to(self.root).as_posix(),
                                           sha256=digest(run / 'ours.pdf'), pages=native['pages'])
                if not reuse_references:
                    command = [arg.replace('{input}', str(run / 'source.docx'))
                               .replace('{output}', str(run / f'{reference_id}.pdf'))
                               .replace('{temporary}', temporary) for arg in configured_command]
                    stage('reference', command)
                    reference = run / f'{reference_id}.pdf'
                    if not reference.exists() or reference.stat().st_size > 64 * 1024 * 1024:
                        raise ValueError('Reference PDF is missing or exceeds 64 MiB')
                    doc['pdfs'][reference_id] = dict(path=reference.relative_to(self.root).as_posix(),
                                                     sha256=digest(reference))
                elif not any(key != 'ours' for key in doc['pdfs']):
                    raise ValueError('No valid saved reference for this exact DOCX; generate or import a reference first')
                pairs = [(key, 'ours') for key in doc['pdfs'] if key != 'ours']
                refs = sorted(key for key in doc['pdfs'] if key != 'ours')
                pairs += [(a, b) for index, a in enumerate(refs) for b in refs[index + 1:]]
                for left, right in pairs:
                    pair = f'{left}--{right}'
                    cached = None
                    if (previous.get('status') == 'exported'
                            and previous.get('scorerSha256') == doc['scorerSha256']
                            and all(previous.get('pdfs', {}).get(key, {}).get('sha256') == doc['pdfs'][key]['sha256']
                                    for key in (left, right))):
                        cached = copy_comparison(previous.get('comparisons', {}).get(pair, {}),
                                                 left, right, run / pair, self.root)
                    if cached is not None:
                        metrics = cached
                        doc['resources'][pair] = dict(reused=True)
                    else:
                        output = Path(temporary) / pair
                        stage(pair, [sys.executable, str(SCRIPTS / 'pdf-visual-diff.py'),
                                     str(self.root / doc['pdfs'][left]['path']),
                                     str(self.root / doc['pdfs'][right]['path']), '--output', str(output),
                                     '--dpi', '96', '--text-backend', 'mupdf', '--max-pages', '80',
                                     '--max-total-pixels', '120000000'])
                        metrics = comparison(output / 'report.json', left, right, run / pair, self.root)
                        shutil.rmtree(output)
                    old_metrics = previous.get('comparisons', {}).get(pair, {})
                    same_reference = previous.get('pdfs', {}).get(left, {}).get('sha256') == doc['pdfs'][left]['sha256']
                    if (right == 'ours' and same_reference and previous.get('status') == 'exported'
                            and previous.get('scorerSha256') == doc['scorerSha256']
                            and not old_metrics.get('invalidEvidence')
                            and old_metrics.get('dpi') == metrics['dpi']
                            and old_metrics.get('threshold') == metrics['threshold']):
                        metrics['baseline'] = dict(engineSha256=previous.get('engineSha256'),
                                                  errorPercent=old_metrics['errorPercent'],
                                                  deltaPercentagePoints=metrics['errorPercent'] - old_metrics['errorPercent'],
                                                  pageCountMismatch=old_metrics.get('pageCountMismatch'),
                                                  sizeMismatch=old_metrics.get('sizeMismatch'),
                                                  firstDivergence=old_metrics.get('firstDivergence'),
                                                  worstPageError=max((page['errorPercent'] for page in old_metrics.get('pages', [])), default=None))
                    doc['comparisons'][pair] = metrics
                    doc['pdfs'][left]['pages'] = metrics['leftPages']
                    doc['pdfs'][right]['pages'] = metrics['rightPages']
                if digest(run / 'source.docx') != identity:
                    raise ValueError('Source copy was modified during conversion')
                if engine_identity() != doc['engineSha256']:
                    for metrics in doc['comparisons'].values():
                        metrics['invalidEvidence'] = True
                    raise ValueError('Engine sources changed during generation; rerun this document')
            doc['status'] = 'exported'
        except InterruptedError:
            shutil.rmtree(run)
            raise
        except Exception as error:
            doc.update(status='error', message=str(error))
        write_json(previous_path, doc)
        # Only task-owned runs for this identical input are replaced. Captures have been copied above.
        if doc['status'] == 'exported':
            for old in (destination / 'runs').iterdir():
                if old.is_dir() and old.name != run_id:
                    shutil.rmtree(old)
        return doc
