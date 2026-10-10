#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Import a completed benchmark or hash-verified captured references into the local viewer."""
import argparse
import fcntl
import os
import re
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from catalog import DEFAULT_DATA, check_disk_budget, read_json, write_json
from evidence import comparison, copy_asset, digest, font_substitutions, set_pdf
from processes import run_owned
from font_diagnostic import metadata as font_diagnostic_metadata


def import_benchmark(path, root, reference_id):
    report = read_json(path)
    for row in report['results']:
        check_disk_budget(root)
        source = Path(row['input'])
        identity = row['sourceSha256']
        if digest(source) != identity:
            raise ValueError(f'Source identity changed: {source.name}')
        destination = root / 'documents' / identity
        snapshot = destination / 'imports' / uuid.uuid4().hex
        existing = destination / 'document.json'
        doc = read_json(existing) if existing.exists() else dict(id=identity, comparisons={}, pdfs={})
        doc.update(name=source.name, status=row['status'], fonts=font_substitutions(row),
                   message=row.get('error') or row.get('comparisonError'),
                   diagnostics=row.get('diagnostics', []), sourceSha256=identity)
        doc['source'] = copy_asset(source, snapshot / 'source.docx', root)
        doc['diagnostic'] = font_diagnostic_metadata(snapshot / 'source.docx')
        if doc['diagnostic']:
            doc['name'] = f"[Font diagnostic: {doc['diagnostic']['family']}] {doc['diagnostic'].get('originalName', source.name)}"
        folder = path.parent / row['fixture']
        native = folder / 'native.pdf'
        if native.exists():
            set_pdf(doc, 'ours', dict(path=copy_asset(native, snapshot / 'ours.pdf', root),
                                      sha256=digest(native), pages=row.get('pages')))
        diff = folder / 'diff/report.json'
        if row.get('comparison') == 'compared' and diff.exists():
            metadata = read_json(diff)
            reference = Path(metadata['reference'])
            if digest(reference) != row.get('referenceSha256'):
                raise ValueError(f'Reference identity changed: {source.name}')
            if digest(Path(metadata['candidate'])) != digest(native):
                raise ValueError(f'Candidate identity changed: {source.name}')
            set_pdf(doc, reference_id, dict(path=copy_asset(reference, snapshot / f'{reference_id}.pdf', root),
                                            sha256=digest(reference), pages=metadata['referencePages']))
            pair = f'{reference_id}--ours'
            doc['comparisons'][pair] = comparison(diff, reference_id, 'ours', snapshot / pair, root)
            doc['comparisons'][pair]['invalidEvidence'] = report.get('engineCodeUnchanged') is False
        write_json(existing, doc)


def import_references(path, root, reference_id, compare_references):
    manifest = read_json(path)
    for identity, entry in manifest['documents'].items():
        check_disk_budget(root)
        destination = root / 'documents' / identity
        snapshot = destination / 'imports' / uuid.uuid4().hex
        document_path = destination / 'document.json'
        if not document_path.exists():
            continue
        doc = read_json(document_path)
        source = Path(entry.get('source') or root / doc['source'])
        if not source.is_absolute():
            source = path.parent / source
        if digest(source) != identity:
            raise ValueError(f'Source identity changed: {doc["name"]}')
        reference = Path(entry['pdf'])
        if not reference.is_absolute():
            reference = path.parent / reference
        if digest(reference) != entry['pdfSha256']:
            raise ValueError(f'Reference identity changed: {doc["name"]}')
        set_pdf(doc, reference_id, dict(path=copy_asset(reference, snapshot / f'{reference_id}.pdf', root),
                                        sha256=digest(reference), provenance=entry.get('provenance')))
        candidates = [key for key in doc['pdfs'] if key != reference_id and (key == 'ours' or compare_references)]
        for candidate in candidates:
            if digest(root / doc['pdfs'][candidate]['path']) != doc['pdfs'][candidate]['sha256']:
                raise ValueError(f'Candidate identity changed: {doc["name"]}')
            pair = f'{reference_id}--{candidate}'
            print(f'Comparing {doc["name"]}: {pair}', flush=True)
            with tempfile.TemporaryDirectory(prefix='pdf-validation-import-') as scratch:
                output = Path(scratch) / 'diff'
                run_owned([sys.executable, str(Path(__file__).resolve().parents[1] / 'pdf-visual-diff.py'),
                                str(reference), str(root / doc['pdfs'][candidate]['path']),
                                '--output', str(output), '--dpi', '96', '--text-backend', 'mupdf',
                                '--max-pages', '80', '--max-total-pixels', '120000000'],
                          Path(scratch) / 'compare.log', threading.Event(), timeout=180,
                          disk_guard=lambda: check_disk_budget(root, temporary=Path(scratch)))
                doc['comparisons'][pair] = comparison(output / 'report.json', reference_id, candidate,
                                                     snapshot / pair, root)
                doc['pdfs'][reference_id]['pages'] = doc['comparisons'][pair]['leftPages']
        write_json(document_path, doc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--benchmark', type=Path)
    group.add_argument('--references', type=Path)
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--reference-id', default='reference-b')
    parser.add_argument('--label', default='Reference B')
    parser.add_argument('--compare-references', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'reference-[a-z0-9-]+', args.reference_id):
        parser.error('Use a reference ID such as reference-a')
    root = args.data.resolve()
    lock = open(Path(tempfile.gettempdir()) / f'pdf-validation-{os.getuid()}.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error('A watcher or import is active; stop it or use a --no-watch viewer before importing')
    settings_path = root / 'settings.json'
    settings = read_json(settings_path) if settings_path.exists() else {}
    settings.setdefault('labels', {})[args.reference_id] = args.label
    write_json(settings_path, settings)
    if args.benchmark:
        import_benchmark(args.benchmark.resolve(), root, args.reference_id)
    else:
        import_references(args.references.resolve(), root, args.reference_id, args.compare_references)


if __name__ == '__main__':
    main()
