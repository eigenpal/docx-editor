# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Local evidence schema and explicit scoring; no conversion or application control."""
import json
import math
import shutil
from pathlib import Path

DEFAULT_DATA = Path(__file__).resolve().parents[2] / '.local-validation'


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temp.replace(path)


def check_disk_budget(root, extra_bytes=0, temporary=None):
    if shutil.disk_usage(root).free - extra_bytes < 1024**3:
        raise RuntimeError('Less than 1 GiB free disk space; validation paused')
    settings = read_json(root / 'settings.json') if (root / 'settings.json').exists() else {}
    limit = int(settings.get('maxDataMiB', 2048)) * 1024 * 1024
    size = extra_bytes
    for directory in [root / 'documents', root / 'inbox', root / 'diagnostics', *([temporary] if temporary else [])]:
        for path in directory.rglob('*'):
            if not path.is_symlink() and path.is_file():
                try:
                    size += path.stat().st_size
                except FileNotFoundError:
                    continue
                if size > limit:
                    raise RuntimeError('Local evidence exceeds its disk budget; archive old documents before retrying')


def score(comparison):
    error = comparison.get('errorPercent')
    valid = (isinstance(error, (int, float)) and not isinstance(error, bool)
             and math.isfinite(error) and 0 <= error <= 100)
    reasons = []
    if not valid:
        return dict(verdict='unscored', similarity=None, reasons=['No valid pixel measurement'])
    if comparison.get('pageCountMismatch'):
        reasons.append('Page count differs')
    if comparison.get('sizeMismatch'):
        reasons.append('Page dimensions differ')
    if error >= 1:
        reasons.append('Pixel difference is at least 1%')
    if any(page.get('errorPercent', 0) >= 1 for page in comparison.get('pages', [])):
        reasons.append('At least one page has 1% or greater pixel difference')
    if comparison.get('invalidEvidence'):
        reasons.append('Evidence identity or run consistency failed')
    return dict(verdict='fail' if reasons else 'pass', similarity=100 - error, reasons=reasons)


def summarize(document):
    result = {k: document.get(k) for k in
              ('id', 'name', 'status', 'message', 'fonts', 'referenceFailures', 'run', 'engineSha256', 'diagnostic')}
    result['comparisons'] = {}
    for key, comparison in document.get('comparisons', {}).items():
        summary = {k: v for k, v in comparison.items() if k != 'pages'}
        summary.update(score(comparison))
        if document.get('status') != 'exported':
            summary.update(verdict='unscored', reasons=['Generation did not complete successfully'])
        summary['worstPageError'] = max(
            (page['errorPercent'] for page in comparison.get('pages', [])), default=0)
        result['comparisons'][key] = summary
    return result


def run_summary(document, root, elapsed_seconds=None):
    """Compact feedback for one iteration; full evidence remains the source of truth."""
    result = {key: document.get(key) for key in
              ('id', 'name', 'status', 'message', 'sourceSha256', 'engineSha256', 'scorerSha256',
               'referenceMode', 'referenceFailures', 'diagnostic', 'fonts')}
    result.update(schemaVersion=1, targetErrorPercent=1, firstDivergenceTriggerPercent=0.1,
                  evidence=str(root / 'documents' / document['id'] / 'document.json'),
                  source=str(root / document['source']) if document.get('source') else None,
                  pdfs={key: {**value, 'path': str(root / value['path'])}
                        for key, value in document.get('pdfs', {}).items()},
                  resources=document.get('resources', {}), comparisons={})
    measured = sum(stage.get('elapsedSeconds', 0) for stage in result['resources'].values())
    result['timing'] = dict(measuredStagesSeconds=round(measured, 3))
    if elapsed_seconds is not None:
        result['timing'].update(elapsedSeconds=round(elapsed_seconds, 3),
                               otherSeconds=round(max(0, elapsed_seconds - measured), 3))
    for pair, comparison in document.get('comparisons', {}).items():
        compact = {key: comparison.get(key) for key in
                   ('errorPercent', 'leftPages', 'rightPages', 'pageCountMismatch', 'sizeMismatch',
                    'invalidEvidence', 'dpi', 'threshold', 'firstDivergence', 'baseline')}
        compact.update(score(comparison))  # Always score every page, including omitted previews.
        if document.get('status') != 'exported':
            compact.update(verdict='unscored', reasons=['Generation did not complete successfully'])
        pages = comparison.get('pages', [])
        worst = max(pages, key=lambda page: page['errorPercent'], default=None)
        compact['worstPage'] = ({key: worst[key] for key in ('number', 'errorPercent')}
                                if worst else None)
        first = comparison.get('firstDivergence')
        selected = {first['page'], max(1, first['page'] - 1)} if first else set()
        compact['inspectPages'] = [
            {**page, 'images': {role: str(root / path) for role, path in page.get('images', {}).items()}}
            for page in pages if page['number'] in selected]
        text = comparison.get('text', {})
        compact['text'] = {key: text.get(key) for key in ('missing', 'extra', 'crossPage', 'medianDistancePt')}
        compact['text']['earliestMovements'] = text.get('earliestMovements', [])[:6]
        compact['text']['pageDrift'] = [page for page in text.get('pageDrift', [])
                                        if page.get('page') in selected]
        result['comparisons'][pair] = compact
    result['guidance'] = ('Inspect each first divergent page from top to bottom and its preceding page. '
                          'Later errors can be accumulated drift; this is not a causal diagnosis. '
                          'Paths refer to this run and may be replaced by the next successful rerun. '
                          'otherSeconds includes hashing, evidence copies, and disk checks; '
                          'cached comparisons have no measured subprocess time.')
    return result


def catalog(root):
    settings = root / 'settings.json'
    result = dict(schemaVersion=1, labels={'ours': 'Our exporter'}, documents=[], warnings=[])
    if settings.exists():
        result['labels'].update(read_json(settings).get('labels', {}))
    for path in sorted((root / 'documents').glob('*/document.json')):
        try:
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError('Evidence must stay inside the data directory')
            data = read_json(path)
            if data['id'] != path.parent.name:
                raise ValueError('Document ID does not match its directory')
            result['documents'].append(summarize(data))
        except (ValueError, KeyError, TypeError, OSError) as error:
            result['warnings'].append(f'{path.parent.name}: {error}')
    return result


def triage(root, pair=None, include_diagnostics=False):
    data = catalog(root)
    diagnostics = [doc for doc in data['documents'] if doc.get('diagnostic')]
    if not include_diagnostics:
        data['documents'] = [doc for doc in data['documents'] if not doc.get('diagnostic')]
    selected_pair = pair
    issues = []
    for document in data['documents']:
        comparisons = {key: value for key, value in document['comparisons'].items()
                       if selected_pair is None or key == selected_pair}
        for pair, comparison in comparisons.items():
            if comparison['verdict'] != 'pass':
                first = comparison.get('firstDivergence')
                issues.append(dict(document=document['id'], name=document['name'], pair=pair,
                                   **comparison,
                                   fontSubstitutions=document.get('fonts') or [],
                                   diagnostic=document.get('diagnostic'),
                                   inspectFromPage=max(1, first['page'] - 1) if first else 1,
                                   evidence=f'documents/{document["id"]}/document.json'))
        if document['status'] != 'exported' or not comparisons:
            issues.append(dict(document=document['id'], name=document['name'], pair=None,
                               verdict='unscored', diagnostic=document.get('diagnostic'), message=document.get('message') or 'No comparison available',
                               evidence=f'documents/{document["id"]}/document.json'))
    issues.sort(key=lambda issue: (
        issue.get('firstDivergence', {}).get('page', 10**9) if issue.get('firstDivergence') else 10**9,
        issue.get('firstDivergence', {}).get('topPt', 0) if issue.get('firstDivergence') else 0,
        -issue.get('errorPercent', 0)))
    pairs = sorted({pair for document in data['documents'] for pair in document['comparisons']})
    coverage = {pair: dict(scored=sum(pair in doc['comparisons'] for doc in data['documents']),
                           total=len(data['documents'])) for pair in pairs}
    return dict(schemaVersion=1, targetErrorPercent=1, firstDivergenceTriggerPercent=0.1, coverage=coverage,
                guidance='Inspect the first divergent page from top to bottom, plus its preceding page. '
                         'Later differences can be accumulated drift. This ordering is a triage heuristic, '
                         'not proof of causation. Pixel similarity includes blank margins; text matching is heuristic. '
                         'Font substitutions are flags, never automatic score exclusions.',
                selectedPair=selected_pair, excludedDiagnostics=0 if include_diagnostics else len(diagnostics),
                labels=data['labels'], issues=issues, warnings=data['warnings'])
