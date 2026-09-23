# Browser eval probe

Run the probe from the editor checkout. Keep inputs and output outside this repository. Install dependencies with `bun install --frozen-lockfile`. Install the pinned headless browser with `bunx playwright install chromium --only-shell` if it is absent. The probe uses the headless shell to limit browser memory.

```bash
bun e2e/evaluation-browser.ts \
  --input /tmp/synthetic.docx \
  --output /tmp/browser-result.json
```

The command builds the shared React harness, then starts a small static server. Compilation finishes before Chromium starts. Each document gets a fresh Chromium process. The command exits with `0` when all documents pass, or `1` for failures and blocked recipes. `--base-url http://127.0.0.1:5273` reuses a running development server.

Use `--manifest /tmp/jobs.json` for up to 100 documents with one shared static server:

```json
[
  {
    "input": "/tmp/normalized.docx",
    "output": "/tmp/normalized-browser.json",
    "artifacts": "/tmp/browser-evidence"
  }
]
```

Each document receives a separate browser process and context. The probe intercepts the fixture request and supplies the input bytes. It never copies eval documents into the checkout. Browser requests outside the local server origin are blocked.

## Recipe and checks

The `pointer-insert-undo-redo-v1` recipe uses a real pointer click on visible body text. It reads the resulting canonical caret and types `Q` through the keyboard. It checks edit admission before typing. A refused edit produces a blocked recipe with the engine reason. It never disables document protection. It checks the exact text insertion across all main-story paragraphs. Unrelated paragraph text must remain unchanged. It also checks the insertion against the previous layout-text projection. Non-text atoms can have different model and layout representations. Canonical text checks remain exact.

Keyboard undo must restore text and the canonical main-document fingerprint. Keyboard redo must restore the insertion. The probe saves the result and loads those saved bytes. It compares reopened text and the main-document semantic digest. It then compares incremental layout geometry with fresh layout geometry. Geometry includes page, paragraph, line, span, table, header, and footer records. Coordinates use 0.001-point precision. Revision and source identifiers are excluded.

The JSON result contains `protocol`, `level`, `recipe`, `status`, `sourceHash`, `identity`, `checks`, `coverage`, `target`, `change`, `geometryHashes`, `timings`, `firstDifference`, `failure`, and `evidence`. It records text hashes and character counts instead of body text. `firstDifference` identifies the first unequal geometry value. `coverage` reports completed checks. Missing checks never count as passes.

`passed` means this recipe passed. `failed` means a checked invariant failed. `blocked` means the recipe could not finish, including empty visible text, opening errors, and resource limits. Report all three statuses separately.

A failed or blocked document receives a screenshot and Playwright action trace when the browser remains responsive. Traces omit resource snapshots and automatic screenshots to limit memory. Passing documents produce neither artifact. Evidence can contain document text. Its default directory is `RESULT.json.artifacts`.

## Cache identity and limits

```bash
bun e2e/evaluation-browser.ts --identity
```

This prints hashes for the recipe source, launched Chromium executable, and packaged font assets. It also reports the viewport, platform, architecture, Playwright version, Bun version, and the Node.js build runtime. Include the source document hash and editor source identity in cache keys. Include core, React, fonts, the Vite application, and its test harness in the editor identity. Also include root Tailwind and PostCSS configuration. Compare identity before and after a run if another process can edit those files. Prefer normalized eval inputs.

Each document has a 90-second limit and a 32 MiB input limit. Further bounds are 1,000 pages, 20,000 main-story paragraphs, and 4,000,000 text characters. The eval runner must retain its process memory limits and process-group cleanup.

This recipe does not check drag selection, formatting, images after editing, comments, tracked changes, or external visual references. It does not prove full editing compatibility. Matching fresh layout can still contain layout defects. Use separate preservation checks for package parts outside the main story.

Run the synthetic integration test:

```bash
bun test ./e2e/evaluation-browser.test.ts
```

The test checks plain text, anchored images, hidden text, an empty document, and a protected document. The last two documents produce blocked recipes. It also checks failure evidence and measured coverage.
