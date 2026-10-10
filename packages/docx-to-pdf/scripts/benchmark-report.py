#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Create a local review index from a completed benchmark report."""
import collections
import html
import json
from pathlib import Path
import sys


def render(path):
    report = json.loads(path.read_text())
    results = report['results']
    counts = collections.Counter(row.get('status', 'failed') for row in results)
    rows = []
    for result in sorted(results, key=lambda row: -row.get('strongChangedPercent', -1)):
        name = html.escape(Path(result['input']).name)
        folder = html.escape(result['fixture'], quote=True)
        status = html.escape(result.get('comparison') or result.get('status', 'failed'))
        score = result.get('strongChangedPercent')
        score_text = f'{score:.3f}%' if score is not None else '—'
        native = result.get('pages', '—')
        reference = result.get('referencePages', '—')
        links = f'<a href="{folder}/result.json">Evidence</a>'
        if result.get('referenceFontNames'):
            links += '<details><summary>Reference fonts</summary>' + html.escape(', '.join(result['referenceFontNames'])) + '</details>'
        if result.get('comparison') == 'compared':
            links += f' · <a href="{folder}/diff/report.json">Metrics</a><details><summary>Page montages</summary>'
            links += ' '.join(
                f'<a href="{folder}/diff/pages/page-{page:04d}/montage.png">{page}</a>'
                for page in range(1, max(native, reference) + 1)
            ) + '</details>'
        rows.append(f'<tr><td>{name}</td><td>{status}</td><td>{native} / {reference}</td><td>{score_text}</td><td>{links}</td></tr>')
    content = '''<!doctype html><meta charset="utf-8"><title>DOCX PDF fidelity benchmark</title>
<style>body{font:15px system-ui;margin:32px;color:#18202a}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}a{color:#075fa6}details a{display:inline-block;padding:4px}p{max-width:900px}</style>
<h1>DOCX PDF fidelity benchmark</h1>
<p>Export success does not certify Word fidelity. Pixel differences include blank page margins. Text matching can confuse repeated words, leaders, equations, and updated fields. Review the montages.</p>'''
    if report.get('engineCodeUnchanged') is False:
        content += '<p><strong>INVALID COMPARISON: engine code changed during this run. Rerun before using these measurements.</strong></p>'
    content += '<p>' + html.escape(str(dict(counts))) + '</p>'
    content += '<p>Reference: ' + html.escape(report.get('referenceEngine', 'unknown')) + '. View: ' + html.escape(report.get('referenceDisplayMode', 'not recorded')) + '.</p>'
    content += '<p>Check reference fonts against native font resolution before attributing typography differences to the engine.</p>'
    content += '<table><thead><tr><th>Document</th><th>Result</th><th>Native / reference pages</th><th>Strong pixel difference</th><th>Review</th></tr></thead><tbody>'
    content += ''.join(rows) + '</tbody></table>'
    path.with_name('index.html').write_text(content)


if __name__ == '__main__':
    render(Path(sys.argv[1]))
