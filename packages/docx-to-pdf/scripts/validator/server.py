#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Loopback-only, read-only PDF validation viewer. Python standard library only."""
import argparse
import json
import mimetypes
import re
import os
import signal
import time
import uuid
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from catalog import DEFAULT_DATA, catalog, check_disk_budget, read_json, run_summary, score, triage

UI = Path(__file__).resolve().parent



def _header_value(value):
    """A header value with every line break removed; the values here are formatted integers."""
    return value.replace('\r', '').replace('\n', '')

def contained(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise FileNotFoundError(relative)
    return path


def handler_for(root, worker=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy',
                             "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            super().end_headers()

        def do_HEAD(self):
            self.respond(head=True)

        def do_GET(self):
            self.respond()

        def do_POST(self):
            port = self.server.server_address[1]
            host = self.headers.get('Host')
            if (host not in (f'127.0.0.1:{port}', f'localhost:{port}')
                    or self.headers.get('Origin') != f'http://{host}'):
                self.send_error(403)
                return
            if self.path != '/api/inbox' or not worker:
                self.send_error(404)
                return
            name = unquote(self.headers.get('X-Filename', ''))
            if not name or '/' in name or '\\' in name or not name.lower().endswith('.docx') or len(name) > 200:
                self.send_error(400, 'Expected a DOCX filename')
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if not 0 < length <= 20 * 1024 * 1024:
                self.send_error(413, 'Input limit is 20 MiB')
                return
            try:
                check_disk_budget(root, extra_bytes=length)
            except RuntimeError as error:
                self.send_error(507, str(error))
                return
            inbox = root / 'inbox'
            inbox.mkdir(parents=True, exist_ok=True)
            temporary = inbox / (uuid.uuid4().hex + '.upload')
            # Never overwrite a drop with the same filename; use a unique queue entry.
            target = inbox / ('upload-' + uuid.uuid4().hex + '--' + name)
            try:
                self.connection.settimeout(30)
                remaining = length
                with temporary.open('xb') as stream:
                    while remaining:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            raise ValueError('Incomplete upload')
                        stream.write(chunk)
                        remaining -= len(chunk)
                temporary.replace(target)
                self.json_response({'queued': target.name}, False)
            except (OSError, ValueError):
                self.send_error(400, 'Upload interrupted')
            finally:
                temporary.unlink(missing_ok=True)

        def respond(self, head=False):
            port = self.server.server_address[1]
            if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                self.send_error(403, 'Local access only')
                return
            try:
                route = unquote(urlsplit(self.path).path)
                if route == '/api/catalog':
                    self.json_response(catalog(root), head)
                elif route == '/api/triage':
                    self.json_response(triage(root), head)
                elif route == '/api/state':
                    state = dict(worker.state) if worker else dict(status='view-only', queue=[], current=None)
                    state['inbox'] = str(root / 'inbox')
                    if (root / 'last-error.json').exists():
                        state['lastError'] = read_json(root / 'last-error.json')
                    self.json_response(state, head)
                elif re.fullmatch(r'/api/documents/[a-f0-9]{64}', route):
                    path = contained(root, f'documents/{route.rsplit("/", 1)[1]}/document.json')
                    document = read_json(path)
                    for comparison in document.get('comparisons', {}).values():
                        comparison.update(score(comparison))
                        if document.get('status') != 'exported':
                            comparison.update(verdict='unscored', reasons=['Generation did not complete successfully'])
                    self.json_response(document, head)
                elif route.startswith('/assets/'):
                    path = contained(root, route[len('/assets/'):])
                    if path.suffix.lower() not in ('.png', '.pdf', '.docx'):
                        raise FileNotFoundError(route)
                    self.file_response(path, head)
                elif route in ('/', '/app.js', '/style.css'):
                    self.file_response(UI / ('index.html' if route == '/' else route[1:]), head)
                else:
                    self.send_error(404)
            except (FileNotFoundError, ValueError):
                self.send_error(404)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except OSError:
                self.send_error(503, 'Evidence temporarily unavailable; refresh after import')

        def json_response(self, data, head):
            body = json.dumps(data, allow_nan=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)

        def file_response(self, path, head):
            # Bound memory even for large PDFs; support browser PDF range requests.
            with path.open('rb') as stream:
                size = path.stat().st_size
                start, end, status = 0, size - 1, 200
                range_header = self.headers.get('Range')
                if range_header:
                    match = re.fullmatch(r'bytes=(\d{0,15})-(\d{0,15})', range_header)
                    if not match or not any(match.groups()):
                        self.send_error(416)
                        return
                    left, right = match.groups()
                    start = int(left) if left else max(0, size - int(right))
                    end = min(size - 1, int(right)) if left and right else size - 1
                    if start > end or start >= size:
                        self.send_response(416)
                        self.send_header('Content-Range', f'bytes */{size}')
                        self.end_headers()
                        return
                    status = 206
                # Header values are rebuilt from clamped integers, never from request text: the
                # digits-only pattern above already forbids anything but a number, and the clamp
                # keeps every value inside the file. The line-break strip is belt and braces for
                # the same property, stated in the form a scanner can follow.
                start = max(0, min(int(start), size - 1))
                end = max(start, min(int(end), size - 1))
                self.send_response(status)
                self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', _header_value(str(int(end - start + 1))))
                if status == 206:
                    self.send_header('Content-Range', _header_value('bytes %d-%d/%d' % (start, end, size)))
                self.end_headers()
                if not head:
                    stream.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = stream.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--port', type=int, default=5190)
    parser.add_argument('--no-watch', action='store_true', help='Serve existing evidence without starting converters')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--font-copy', type=Path, help='Create a separate shared-font diagnostic DOCX and exit')
    parser.add_argument('--reuse-references', action='store_true', help='With --once, rerun native against hash-verified saved PDFs; launch no reference converter')
    parser.add_argument('--summary', action='store_true', help='With --once, print compact iteration feedback; retain full evidence on disk')
    parser.add_argument('--pair', help='Restrict --report to one comparison, e.g. reference-a--ours')
    parser.add_argument('--include-diagnostics', action='store_true', help='Include modified font copies in --report')
    parser.add_argument('--font-family', help='Family for --font-copy, --enqueue, or --once diagnostic copies')
    modes.add_argument('--report', action='store_true', help='Print machine-readable triage JSON and exit')
    modes.add_argument('--once', type=Path, help='Validate one DOCX, print its JSON evidence, and exit')
    modes.add_argument('--enqueue', type=Path, help='Copy one DOCX into the running worker inbox and exit')
    args = parser.parse_args()
    if args.reuse_references and not args.once:
        parser.error('--reuse-references requires --once')
    if args.summary and not args.once:
        parser.error('--summary requires --once')
    if not 0 <= args.port <= 65535:
        parser.error('Port must be between 0 and 65535')
    args.data.mkdir(parents=True, exist_ok=True)
    root = args.data.resolve()
    if args.font_family or args.font_copy:
        if not args.font_family or not (args.font_copy or args.enqueue or args.once):
            parser.error('--font-family requires --font-copy, --enqueue, or --once (and vice versa)')
        from font_diagnostic import create_copy
        try:
            result = create_copy((args.font_copy or args.enqueue or args.once).resolve(strict=True), root, args.font_family)
        except (ValueError, OSError) as error:
            parser.error(str(error))
        if args.font_copy:
            print(json.dumps(result, indent=2))
            return
        if args.enqueue:
            args.enqueue = Path(result['source'])
        else:
            args.once = Path(result['source'])
    if args.enqueue:
        from evidence import digest
        source = args.enqueue.resolve(strict=True)
        if source.suffix.lower() != '.docx' or not 0 < source.stat().st_size <= 20 * 1024 * 1024:
            parser.error('Expected a DOCX of at most 20 MiB')
        inbox = root / 'inbox'
        inbox.mkdir(parents=True, exist_ok=True)
        check_disk_budget(root, extra_bytes=source.stat().st_size)
        target = inbox / ('upload-' + uuid.uuid4().hex + '--' + source.name)
        temporary = target.with_suffix('.upload')
        try:
            shutil.copyfile(source, temporary)
            identity = digest(temporary)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        print(json.dumps(dict(queued=target.name, sourceSha256=identity,
                              evidence=f'/api/documents/{identity}')))
        return
    if args.report:
        print(json.dumps(triage(root, args.pair, args.include_diagnostics), indent=2))
        return
    worker = None
    if not args.no_watch or args.once:
        try:
            from pipeline import Worker
        except ImportError:
            parser.error('Worker dependencies missing. Install the local runtime described in scripts/validator/README.md, or use --no-watch.')
        worker = Worker(root)
    if args.once:
        # Reuse the same global automation lock without starting the watcher.
        import fcntl
        import tempfile
        from evidence import digest
        lock = open(Path(tempfile.gettempdir()) / f'pdf-validation-{os.getuid()}.lock', 'a')
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                parser.error('A watcher is active; use --enqueue, or stop it before --once')
            settings = read_json(root / 'settings.json') if (root / 'settings.json').exists() else {}
            started = time.monotonic()
            document = worker.process(args.once.resolve(strict=True), settings, reuse_references=args.reuse_references)
            elapsed = time.monotonic() - started
            for comparison in document.get('comparisons', {}).values():
                comparison.update(score(comparison))
                if document.get('status') != 'exported':
                    comparison.update(verdict='unscored', reasons=['Generation did not complete successfully'])
            print(json.dumps(run_summary(document, root, elapsed) if args.summary else document, indent=2))
        finally:
            lock.close()
        if document.get('status') != 'exported':
            raise SystemExit(1)
        return
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(root, worker))
    print(f'PDF Export Validator: http://127.0.0.1:{server.server_port}', flush=True)
    print(f'Local evidence: {args.data.resolve()}', flush=True)
    try:
        if worker:
            worker.start()
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if worker:
            worker.close()
        server.server_close()


if __name__ == '__main__':
    main()
