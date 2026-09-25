# Eval protocol

These commands serve the separate `docx-eval` repository. They do not add public document automation APIs.

Protocol version 1 separates candidate exports, measurements, comparisons, and detailed evidence.

```sh
bun --tsconfig-override packages/docx-to-pdf/tsconfig.json \
  packages/docx-to-pdf/scripts/evaluation/export.ts input.docx output.pdf

python packages/docx-to-pdf/scripts/evaluation/worker.py \
  measure input.pdf measurement.json.gz

python packages/docx-to-pdf/scripts/evaluation/worker.py \
  compare reference.json.gz result.json --candidate candidate.json.gz

python packages/docx-to-pdf/scripts/evaluation/worker.py \
  evidence reference.pdf evidence --candidate candidate.pdf --pages 1,2

python packages/docx-to-pdf/scripts/evaluation/worker.py \
  page input.pdf preview --pages 1

bun --tsconfig-override packages/docx-to-pdf/tsconfig.json \
  packages/docx-to-pdf/scripts/evaluation/probe.ts input.docx checks.json

bun --tsconfig-override packages/docx-to-pdf/tsconfig.json \
  packages/docx-to-pdf/scripts/evaluation/trace.ts input.docx trace.json \
  --page 1 --y 200

bun e2e/evaluation-browser.ts --input input.docx --output browser.json
```

Use the evaluator's locked Python environment, which supplies PyMuPDF and Pillow. Run commands in bounded child processes. PDF measurement can allocate native memory.

Exports use proposed content, no comments, packaged fonts, and best-effort rendering. Diagnostics remain part of the export response. Approximate output is never reported as strict success.

Measurements include word positions, page dimensions, color signatures, and drawing metadata. Comparisons reuse the text movement algorithm in `pdf-visual-diff.py`. Object counts alone never establish missing visible content. Visual screening uses a 144 by 192 RGB signature with local regions. Older 48 by 64 grayscale measurements remain readable. Detailed evidence uses 144 DPI and processes at most three pages. `firstDivergence` identifies a measured location with explicit confidence and coordinate space. Text excerpts are bounded and untrusted.

The `page` operation renders one page at 144 DPI into `page.png`.
Its `report.json` contains page dimensions in points and the PDF rotation matrix.
Apply that matrix to measured coordinates before drawing highlights over a rotated page.
Missing page numbers fail explicitly. The evaluator owns preview caching and navigation.

Headless probes check package preservation, deterministic insertion, undo, and save/reopen. They compare modeled structure, semantic hashes, relationships, and unchanged binary hashes. The retained-layout check uses fixed metrics and body content. It excludes production font resolution, styles-part cascades, headers, footers, and actual browser input. Unsupported checks remain explicit.

Layout traces return up to three nearby records, including source node IDs and resolved geometry. They contain no document text and stay below 8,000 characters. Use `--kind drawing`, `--kind table`, or `--kind paragraph` to restrict nearby records. `baselineOffsetPt` records the baseline offset within its line. Reference correspondence remains approximate. Textbox interiors and pagination decision history are not included.

The browser recipe checks pointer placement, keyboard insertion, undo/redo, saved body content, and fresh layout. It uses a local demo server and blocks external browser requests. Batch mode reuses the static server and starts a fresh browser process for each document. The parent caches results using browser, recipe, font, and engine identities. It does not cover drag selection, formatting, or review operations. See [Browser eval probe](../../../../e2e/evaluation-browser.md).

The evaluator owns caching, application reference capture, feature grouping, and run acceptance. It binds cached results to these source files and their runtime versions. A comparison change must invalidate comparison evidence independently of candidate exports.

## Fast pagination and text screening

`layout-summary.ts input.docx output.json` opens the production font-backed session
and records page counts and logical text without painting or writing a PDF.
Text records include lines, stories, source ranges, and span positions in layout points.
Positions precede paint transforms; rotated content needs PDF evidence for exact highlighting.
The record includes table text, page furniture, and textboxes through the export traversal.
Whitespace tokenization joins styled spans within each line. It can differ from PDF extraction.
`compare_layout` reports this separate scope and bounded excerpts with candidate source locations.
It does not certify visual fidelity. Use the same TypeScript configuration as `export.ts`.

`quick_text.py pdf input.pdf index.json.gz` extracts words without rendering pages.
`quick_text.py measurement measurement.json.gz index.json.gz` reuses an existing
PDF measurement. Both produce a versioned dictionary and per-page token arrays.
The evaluator caches these indexes by PDF content identity and extraction version.
Bump `INDEX_VERSION` when extraction or normalization changes. Matcher changes use
an independent comparison identity and do not invalidate reference indexes.

The Python `compare` entry point counts word occurrences in linear time. It reports
page-count error, missing and extra occurrences, and the minimum number of matched
occurrences that must move between pages. Repeated words can make the exact movement
ambiguous. This lower bound does not replace geometric correspondence. Ordered
page sequences distinguish rearranged text from identical text. NFC normalization
preserves case, punctuation, hyphens, and repeated words.

Run synthetic checks with:

```sh
python -m unittest discover -s packages/docx-to-pdf/scripts/evaluation -p 'test_quick_text.py'
bun test packages/docx-to-pdf/scripts/evaluation/layout-summary.test.ts
```

Missing or invalid inputs remain failures. Text screening does not certify visual
fidelity. Use the regular PDF comparison for geometry, drawings, and final evidence.
