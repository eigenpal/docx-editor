# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Normalize existing raster comparisons without inventing fidelity measurements."""
import hashlib
import shutil
from pathlib import Path

from catalog import read_json


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def copy_asset(source, target, root):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() != target.resolve():
        shutil.copy2(source, target)
    return target.relative_to(root).as_posix()


def font_substitutions(row):
    return sorted({family['family'] for family in row.get('fontResolution', {}).get('families', [])
                   if any(face.get('substitution') for face in family.get('faces', []))})


def set_pdf(document, key, info):
    if document['pdfs'].get(key, {}).get('sha256') != info['sha256']:
        document['comparisons'] = {
            pair: value for pair, value in document['comparisons'].items()
            if key not in (value['left'], value['right'])}
    document['pdfs'][key] = info


def comparison(report_path, left, right, destination, root):
    report = read_json(report_path)
    threshold = str(report['strongThreshold'])
    pages = []
    for number, page in enumerate(report['pages'], 1):
        images = {}
        for role, key in [('left', 'reference'), ('right', 'candidate'),
                          ('diff', 'amplified'), ('overlay', 'strongOverlay')]:
            source = Path(page['artifacts'][key])
            if not source.is_absolute():
                source = report_path.parent / source
            images[role] = copy_asset(source, destination / f'page-{number:04d}' / f'{role}.png', root)
        pages.append(dict(number=number, errorPercent=100 * page['changedFractionByThreshold'][threshold],
                          leftPresent=page['referencePresent'], rightPresent=page['candidatePresent'],
                          sizeMismatch=page['sizeMismatch'], images=images,
                          bounds=page.get('strongDifferenceBoundsPt'),
                          bands=page.get('strongDifferenceBandsPt', [])))
    # A low, disclosed trigger locates early drift instead of jumping to its largest consequence.
    flagged = [page for page in pages if page['errorPercent'] >= 0.1 or page['sizeMismatch']
               or not page['leftPresent'] or not page['rightPresent']]
    first = flagged[0] if flagged else None
    text = report.get('textMovement', {})
    return dict(left=left, right=right, dpi=report['dpi'], threshold=int(threshold),
                errorPercent=100 * report['changedFractionByThreshold'][threshold],
                leftPages=report['referencePages'], rightPages=report['candidatePages'],
                pageCountMismatch=report['pageCountMismatch'],
                sizeMismatch=any(page['sizeMismatch'] for page in pages),
                movementSeverity=text.get('severity', report.get('movementSeverity', 'unknown')),
                text=dict(missing=text.get('missingWordCount'), extra=text.get('extraWordCount'),
                          crossPage=text.get('distanceBuckets', {}).get('crossPage'),
                          medianDistancePt=text.get('medianDistancePt'),
                          earliestMovements=text.get('earliestMovements', []),
                          pageDrift=text.get('pageDrift', [])),
                firstDivergence=dict(page=first['number'], topPt=first['bounds'][1]
                                    if first.get('bounds') else 0) if first else None,
                pages=pages)
