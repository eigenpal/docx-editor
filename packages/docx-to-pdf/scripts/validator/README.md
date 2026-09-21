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
- Pages stay in reading order. **First divergence** opens the earliest page with at least 0.1% changed pixels, different dimensions, or a missing counterpart. Later differences can be accumulated drift; this is a heuristic, not a causal diagnosis.
- Paired previews share one scroll area. The amplified black/white difference and red overlay are optional and off by default. Document, pair, and page selection are shareable in the URL.
- Similarity is `100 - strong changed pixel percent`. It includes blank margins. Unmeasured and failed exports never pass.
- Text movement and unmatched tokens are heuristics, especially for repeated text. Known font substitutions are reported and never silently removed from scores. Captures at different DPI or thresholds must not be treated as interchangeable.

## Resource and lifecycle limits

One worker across worktrees (OS advisory lock), one stage at a time. Defaults: 20 MiB input, 64 MiB reference PDF, 80 comparison pages, 120 million total rendered pixels, 90 seconds and 2 GiB summed descendant RSS per stage. RSS is sampled every 100 ms; the worker also reports its OS high-water mark. At least 1 GiB free disk is required; inbox admission and running stages enforce the local evidence budget. Raster pages are processed sequentially. Only the page images under review are loaded by the UI. The server streams assets in 64 KiB chunks.

Timeout, cancellation, memory overflow, and shutdown interrupt owned children, allow cleanup, then kill remaining owned process identities and groups. Never terminate processes by application name. Private temporary directories are removed on exit. Successful reruns replace old generated runs for that source; failures retain logs. The inbox preserves originals. Ctrl-C stops the worker and server; receipts prevent automatic duplicate work on restart. A hard OS kill cannot run cleanup handlers.

Run the tool's tests with the local Python:

```sh
packages/docx-to-pdf/.local-validation/runtime/bin/python -m unittest discover \
  -s packages/docx-to-pdf/scripts/validator -p 'test_*.py' -v
```
