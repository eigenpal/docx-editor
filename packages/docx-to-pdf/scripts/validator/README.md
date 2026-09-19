# PDF Export Validator

Local development tool under the package's Pro license. From the repository root:

```sh
bun run validation:pdf
```

Open <http://127.0.0.1:5190>. Drop DOCX files into the page or into `packages/docx-to-pdf/.local-validation/inbox/`. The entire `.local-validation/` directory, including its inputs, PDFs, screenshots, scores, logs, settings, and Python runtime, is gitignored. Generated data stays on this machine. Reference display names come exclusively from local settings.

The worker runs the exporter against the package's explicit source aliases, the configured reference adapter, and raster comparisons **sequentially**. Declaration builds are unnecessary; Core edits are picked up directly on the next run. Both outputs must use the final content without revision markup. Captured references for the identical source hash are also compared against the new candidate, and against each other. This viewer never controls a desktop application.

## Local setup

Python 3.11+, Bun, Poppler tools, and a local headless reference adapter are required for generation. The read-only viewer (`--no-watch`) needs only Python's standard library. Install the bounded worker's dependencies locally:

```sh
uv venv packages/docx-to-pdf/.local-validation/runtime
uv pip install --python packages/docx-to-pdf/.local-validation/runtime/bin/python Pillow PyMuPDF psutil
```

Create `.local-validation/settings.json` (local paths only):

```json
{
  "labels": { "ours": "Our exporter", "reference-a": "Reference A", "reference-b": "Reference B" },
  "generatedReference": "reference-b",
  "referenceCommand": ["/absolute/python", "/absolute/reference-adapter.py", "{input}", "{output}"],
  "timeoutSeconds": 90,
  "maxRssMiB": 2048,
  "maxDataMiB": 2048
}
```

`referenceCommand` is an argument array, never shell text. `{input}` and `{output}` are task-owned absolute paths. `{temporary}` is available for adapters requiring an explicit private profile. The child environment sets `TMPDIR`, `TMP`, and `TEMP` to that private directory. An adapter must open the source read-only, disable source macros, export final/no-markup content, close its document, and clean up its own private process group. Configure only a trusted local adapter. Its application name and installation path belong in ignored settings, not code.

## Review order and scoring

- **Worst first** sorts documents by strong pixel difference for the selected pair. Filter failing documents, page-count mismatches, missing comparisons, or known font substitutions. Switch to **Earliest drift** to prioritize early divergence.
- Pages stay in reading order. **First divergence** opens the earliest page with at least 0.1% changed pixels, different dimensions, or a missing counterpart. Inspect its changed regions from top to bottom and the end of the preceding page. Later errors can be accumulated drift; this is a heuristic, not a causal diagnosis.
- Paired previews share one scroll area. The amplified black/white difference and red overlay are optional and off by default. PDF and evidence links retain the original artifacts. Document, pair, and page selection are shareable in the URL.
- Similarity is `100 − strong changed pixel percent`. It includes blank margins. Passing requires **both document and every page below 1%**, matching page counts and dimensions, and valid evidence. Unmeasured and failed exports never pass.
- Text movement and unmatched tokens are heuristics, especially for repeated text. New runs include the earliest moved tokens in reading order and signed vertical drift for each page's first/last third of matched tokens. An increasing top-to-bottom delta helps locate accumulated spacing errors; it does not establish causation. Known font substitutions are reported and never silently removed from scores. Captures at different DPI or thresholds must not be treated as interchangeable.

## Agent workflow

```sh
# Machine-readable top-to-bottom triage, without launching converters:
bun run validation:pdf --report > /tmp/pdf-triage.json

# Queue a DOCX while the viewer is running; returns its source ID for polling:
bun run validation:pdf --enqueue /absolute/input.docx

# One DOCX through the same resource-managed pipeline; JSON evidence to stdout:
# Stop the watcher first, or run the viewer with --no-watch.
bun run validation:pdf --once /absolute/input.docx > /tmp/pdf-document.json

# Serve an alternate evidence folder without automation:
bun run validation:pdf --no-watch --data /absolute/evidence --port 5191
```

Read `/api/triage` for failing pairs, first divergent page and vertical position, preceding-page context, errors, font flags, and relative evidence paths. Read `/api/documents/<source-sha256>` for each page's metrics, changed vertical bands, preview paths, source/PDF identities, diagnostics, and stage resource measurements. `/api/state` reports the serial queue and current stage. `/api/catalog` is a compact index. Evidence is reread from disk; the UI refreshes every five seconds.

Fix the earliest plausible cause, rerun the same source, and compare the changed regions through subsequent pages. Do not treat a high global similarity score as proof of correct pagination, text, or fonts. Re-drop a file (or change its mtime) to retry after an engine fix; completed inbox entries are persisted across restarts.

## Import existing evidence

Use the local runtime's Python to run `scripts/validator/import_data.py` from this package:

```sh
.local-validation/runtime/bin/python scripts/validator/import_data.py \
  --benchmark /absolute/benchmark/report.json --reference-id reference-b --label 'Reference B'
.local-validation/runtime/bin/python scripts/validator/import_data.py \
  --references /absolute/captured/manifest.json --reference-id reference-a --label 'Reference A' \
  --compare-references
```

Captured manifests use the existing benchmark schema: `documents` keyed by DOCX SHA-256, with `pdf`, `pdfSha256`, and optional `source` and `provenance`. PDF paths resolve beside the manifest. Source and reference identities are verified before copying. The second command rasterizes saved PDFs; it launches no reference editor. Imports take the same exclusive automation lock; stop the watcher first or use a `--no-watch` viewer. Large artifact trees are copied into immutable snapshots, never served via external symlinks. Data is local to this worktree and not part of the package distribution.

## Resource and lifecycle limits

One worker across worktrees (OS advisory lock), one stage at a time. Defaults: 20 MiB input, 64 MiB reference PDF, 80 comparison pages, 120 million total rendered pixels, 90 seconds and 2 GiB summed descendant RSS per stage. RSS is sampled every 100 ms; the native worker also reports its OS high-water mark. At least 1 GiB free disk is required; inbox admission and running stages enforce the local evidence budget. Raster pages are processed sequentially. Only the currently reviewed page images are loaded by the UI. The server streams assets in 64 KiB chunks.

Timeout, cancellation, memory overflow, and shutdown interrupt owned children, allow cleanup, then kill remaining owned process identities/groups. Never terminate processes by application name. Private temporary directories are removed on exit. Successful reruns replace old generated runs for that source; failures retain logs. The inbox preserves originals. Ctrl-C stops the worker and server; receipts prevent automatic duplicate work on restart. A hard OS kill cannot run cleanup handlers.

Run the validator tests with the local Python:

```sh
packages/docx-to-pdf/.local-validation/runtime/bin/python -m unittest discover \
  -s packages/docx-to-pdf/scripts/validator -p 'test_*.py' -v
```

## Shared-font diagnostic copies

Use this experiment when a mismatch may come from unavailable or different fonts. Choose a family installed in **every** renderer, including its bold and italic faces. The following example uses Arial; availability is machine-specific.

```sh
# While the watcher is running: make a separate copy and queue both exports.
bun run validation:pdf --enqueue /absolute/input.docx --font-family Arial

# Prepare a copy for an independently captured reference, without converters.
bun run validation:pdf --font-copy /absolute/input.docx --font-family Arial

# With the watcher stopped: generate the diagnostic and JSON evidence once.
bun run validation:pdf --once /absolute/input.docx --font-family Arial

# Keep agent triage focused on the chosen reference and original documents.
bun run validation:pdf --report --pair reference-a--ours
# Explicitly include diagnostic copies when investigating font sensitivity.
bun run validation:pdf --report --pair reference-b--ours --include-diagnostics
```

Copies live under the ignored `diagnostics/` data directory. Their embedded provenance records the original SHA-256 and selected family and survives copying into the inbox. The original bytes are untouched. Run fonts, paragraph marks, styles, numbering, headers/footers, and theme fonts are replaced; theme overrides and embedded-font mappings are removed. Font sizes, emphasis, text, and artwork are preserved. Reference captures must be generated from **this exact copy**, not the original. The distinct source hash prevents reusing original reference PDFs for a modified copy.

Select **Shared-font diagnostics** in the viewer to inspect these experiments. They are excluded from original-document pass counts and default agent triage. A diagnostic passing does **not** satisfy the original-document fidelity goal. Check native `fontResolution`, reference PDF font information, and glyph coverage: family-name equality alone does not prove equal font files or eliminate shaping and metrics differences. Symbol encodings, equations, and artwork may still use specialized fonts. A changed font can change wrapping and page counts, so compare renderers within the same experiment; never subtract the diagnostic score from an original score and call the difference a measured font-only error.

For repeated Core/exporter edits, avoid launching a reference converter again:

```sh
# Stop the watcher first. The viewer can remain available with --no-watch.
bun run validation:pdf --once /absolute/input.docx --reuse-references
```

This reruns only the native exporter and comparisons against hash-verified saved PDFs for the identical source. It needs no reference adapter configuration and uses the same serial lock, timeouts, memory cap, and owned-process cleanup. Missing or invalid references cannot pass. Each comparable native pair includes `baseline.errorPercent`, `baseline.engineSha256`, and `baseline.deltaPercentagePoints`; a negative delta is an improvement. Baselines require the same reference hash, DPI, threshold, and a successful preceding run. Save the JSON output if historical artifacts are needed: successful runs replace the previous generated artifacts.
