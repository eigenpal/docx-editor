# Public API consumer agents

These deterministic agents execute document action plans using public editor-api
imports. They create their input fixtures, save edited DOCX files, reopen them,
and assert targeted edits and preserved content. No LLM credentials are needed.

Run from the repository root after `bun install` and `bun run build:packages`:

```sh
bun run --filter '@docx-editor-examples/editor-api-consumers' typecheck
bun run --filter '@docx-editor-examples/editor-api-consumers' contract
bun run --filter '@docx-editor-examples/editor-api-consumers' report
bun run --filter '@docx-editor-examples/editor-api-consumers' report:browser
REPORT_VERIFY_DOCX=/tmp/editor-api-consumers/report/browser/report.docx bun examples/editor-api-consumers/report-agent.ts
```

The contract command covers the server and the real browser host in Happy DOM.
The report browser command uses Playwright Chromium, which must be installed
(`bunx playwright install chromium`). It saves a screenshot and checks loaded
collection navigation. The final command verifies browser-produced bytes through
the server app's complete preservation assertions. All artifacts are disposable
and written under `/tmp/editor-api-consumers/`.

`report-agent.ts` demonstrates explicit font-backed server pagination. It loads
the repository's Carlito font files and disposes shaping resources after the
runtime; callers outside this repository should supply their own font paths.
The browser gets measured pagination from the configured editor.

See the two `*-feedback.md` files for findings and rerun outcomes, and
`openspec/changes/agent-editing-subset/consumer-review.md` for API fixes and
remaining explicit runtime differences.
