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
