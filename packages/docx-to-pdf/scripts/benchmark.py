#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Isolated strict exports, bounded LibreOffice references, and visual comparisons."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from libreoffice_reference import convert as convert_reference

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parent


def engine_code_hash(root=ROOT):
    """Bind a run to source, built dependencies, resolver configuration, and harness code."""
    paths = {root / name for name in ['bun.lock', 'tsconfig.json', 'package.json']}
    for package in ['core', 'fonts', 'docx-to-pdf']:
        base = root / 'packages' / package
        paths.update(base / name for name in ['package.json', 'tsconfig.json'])
        for directory in ['src', 'dist', 'scripts']:
            paths.update(path for path in (base / directory).rglob('*')
                         if path.is_file() and path.suffix in {'.ts', '.js', '.cjs', '.mjs', '.py', '.json'})
    digest = hashlib.sha256()
    for path in sorted(paths):
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode() + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--dpi', type=int, default=96)
    parser.add_argument('--max-reference-pages', type=int, default=30)
    parser.add_argument('--export-only', action='store_true', help='Measure native export without launching a reference application')
    parser.add_argument('--reference-manifest', type=Path,
                        help='Reuse hash-bound PDFs from Word or LibreOffice without launching either application')
    parser.add_argument('--comparison-timeout', type=int, default=180,
                        help='Per-document comparison deadline in seconds (30–1800)')
    parser.add_argument('inputs', nargs='*', type=Path)
    options = parser.parse_args()
    manifest = None
    if options.reference_manifest:
        if options.export_only:
            parser.error('reference-manifest cannot be combined with export-only')
        manifest = json.loads(options.reference_manifest.read_text())
        if (manifest.get('displayMode') != 'proposed-no-markup'
                or not isinstance(manifest.get('engine'), str)
                or not isinstance(manifest.get('documents'), dict)):
            parser.error('Reference manifest must declare engine, proposed-no-markup displayMode, and documents')
    if not 1 <= options.jobs <= 4 or not 36 <= options.dpi <= 300:
        parser.error('jobs must be 1–4 and DPI must be 36–300')
    if not 30 <= options.comparison_timeout <= 1800:
        parser.error('comparison-timeout must be 30–1800 seconds')
    if not 1 <= options.max_reference_pages <= 1000:
        parser.error('max-reference-pages must be 1–1000')
    output = options.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error('Use an empty output directory; previous evidence is never replaced')
    output.mkdir(parents=True, exist_ok=True)
    inputs = options.inputs or sorted((ROOT / 'e2e/fixtures').glob('*.docx')) + [
        ROOT / 'examples/vite/public/sample.docx'
    ]
    inputs = [path.resolve() for path in inputs]
    start = time.monotonic()
    code_before = engine_code_hash()

    def run(command, timeout):
        return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout)

    def measure(path):
        source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        identity = path.stem + '-' + hashlib.sha256(str(path).encode()).hexdigest()[:8]
        folder = output / identity
        folder.mkdir()
        result = {'input': str(path), 'fixture': identity, 'sourceSha256': source_hash}
        try:
            conversion = run(['bun', str(SCRIPTS / 'benchmark-export.ts'), str(path), str(folder / 'native.pdf')], 60)
            (folder / 'export.log').write_text(conversion.stderr)
            lines = [line for line in conversion.stdout.splitlines() if line.startswith('{')]
            if conversion.returncode or not lines:
                raise RuntimeError('Export worker failed; see export.log')
            result.update(json.loads(lines[-1]))
            if result['status'] != 'exported':
                return result
            if options.export_only:
                result['comparison'] = 'not-requested'
                return result
            if result['pages'] > options.max_reference_pages:
                result['comparison'] = 'skipped-page-budget'
                return result
            references = folder / 'reference'
            references.mkdir()
            reference_pdf = references / (path.stem + '.pdf')
            try:
                if manifest is not None:
                    archived = manifest['documents'].get(source_hash)
                    if archived is None:
                        result['comparison'] = 'reference-missing'
                        return result
                    archived_pdf = (options.reference_manifest.resolve().parent / archived['pdf']).resolve(strict=True)
                    if hashlib.sha256(archived_pdf.read_bytes()).hexdigest() != archived['pdfSha256']:
                        raise RuntimeError('Archived reference PDF hash does not match its manifest')
                    shutil.copyfile(archived_pdf, reference_pdf)
                    result['referenceProvenance'] = archived.get('provenance', str(archived_pdf))
                    (folder / 'reference.log').write_text('Reused hash-verified reference: ' + str(archived_pdf))
                else:
                    reference = convert_reference(path, reference_pdf, timeout=60)
                    (folder / 'reference.log').write_text(reference.stdout + reference.stderr)
                result['referenceDisplayMode'] = 'proposed-no-markup'
                result['referenceSha256'] = hashlib.sha256(reference_pdf.read_bytes()).hexdigest()
                font_list = run(['pdffonts', str(reference_pdf)], 30)
                if font_list.returncode:
                    raise RuntimeError('Could not inspect reference fonts: ' + font_list.stderr)
                (folder / 'reference-fonts.txt').write_text(font_list.stdout)
                result['referenceFontNames'] = sorted({
                    re.sub(r'^[A-Z]{6}\+', '', line.split()[0])
                    for line in font_list.stdout.splitlines()[2:] if line.strip()
                })
            except RuntimeError as error:
                (folder / 'reference.log').write_text(str(error))
                result['comparison'] = 'reference-failed'
                return result
            diff = run([
                sys.executable, str(SCRIPTS / 'pdf-visual-diff.py'), str(reference_pdf),
                str(folder / 'native.pdf'), '--output', str(folder / 'diff'),
                '--dpi', str(options.dpi), '--text-backend', 'mupdf',
                '--max-pages', str(options.max_reference_pages)
            ], options.comparison_timeout)
            (folder / 'diff.log').write_text(diff.stdout + diff.stderr)
            if diff.returncode:
                result['comparison'] = 'diff-failed'
                return result
            metrics = json.loads((folder / 'diff/report.json').read_text())
            result.update(
                comparison='compared', referencePages=metrics['referencePages'],
                strongChangedPercent=100 * metrics['changedFractionByThreshold']['28'],
                movementSeverity=metrics['movementSeverity'],
                textMovement=metrics['textMovement'],
                inkMovementScore=metrics['inkMovementScore'],
            )
        except subprocess.TimeoutExpired:
            result['benchmarkError'] = 'worker-timeout'
        except Exception as error:
            result['benchmarkError'] = str(error)
        finally:
            result['inputFileUnchanged'] = hashlib.sha256(path.read_bytes()).hexdigest() == source_hash
            (folder / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        return result

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=options.jobs) as pool:
        for result in pool.map(measure, inputs):
            results.append(result)
            print(json.dumps({key: result.get(key) for key in [
                'fixture', 'status', 'comparison', 'pages', 'referencePages', 'benchmarkError'
            ]}), flush=True)
    code_after = engine_code_hash()
    report = {
        'engineCodeSha256Before': code_before, 'engineCodeSha256After': code_after,
        'engineCodeUnchanged': code_before == code_after,
        'schemaVersion': 1, 'elapsedSeconds': time.monotonic() - start,
        'dpi': options.dpi, 'maxReferencePages': options.max_reference_pages,
        'comparisonTimeoutSeconds': options.comparison_timeout,
        'displayMode': 'proposed', 'referenceDisplayMode': 'proposed-no-markup',
        'referenceExportMethod': 'hash-verified manifest' if manifest is not None else 'isolated Writer UNO; ShowChanges=false; RedlineDisplayType=0',
        'referenceEngine': ('not requested' if options.export_only else manifest['engine'] if manifest is not None
                            else run(['soffice', '--version'], 10).stdout.strip()),
        'results': results,
    }
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    run([sys.executable, str(SCRIPTS / 'benchmark-report.py'), str(output / 'report.json')], 10)
    print('Report:', output / 'report.json')
    # This command measures fidelity; it does not certify it from export success.
    return 1 if code_before != code_after or any(
        r.get('benchmarkError') or not r['inputFileUnchanged'] for r in results
    ) else 0


if __name__ == '__main__':
    raise SystemExit(main())
