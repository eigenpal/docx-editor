# Public API consumer agents

These deterministic agents execute document action plans using public editor-api
imports. They create their input fixtures, save edited DOCX files, reopen them,
and assert targeted edits and preserved content. No LLM credentials are needed.

Run from the repository root after `bun install` and `bun run build:packages`:

```sh
bun run --filter '@docx-editor-examples/editor-api-consumers' typecheck:published
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

See the `*-feedback.md` files for findings and rerun outcomes, and
`openspec/changes/agent-editing-subset/consumer-review.md` for API fixes and
remaining explicit runtime differences.

The default `typecheck` uses workspace source exports and runs before builds in CI.
`typecheck:published` uses built declarations and runs after package builds in CI.

## Fresh developer audits

Two further agents started with public docs and declarations only. Their programs
retain the original semantic assertions and document each discovered failure:

```sh
bun run --filter '@docx-editor-examples/editor-api-consumers' test:published
```

This command uses Node 24 or newer after package builds to test the same exports a
package consumer receives. It also runs in CI after the build. Node ignores workspace
TypeScript aliases. Ordinary Bun execution in this workspace resolves source aliases.
See `fresh-contract-feedback.md` and `fresh-tables-feedback.md` for the blind findings,
fixes, remaining explicit batching limits, and the scope of the developer-experience score.

## Manual Microsoft Word round trip

Generate the fresh contract fixture with `test:published` first.
Copy its `contract-pending.docx` into a disposable directory.
Open that copy in local Word, append ` — WORD CHECK` to `SERVICE AGREEMENT`, and verify undo and redo.
Save the document in Word, leaving its tracked changes pending.
Then run the checker against built package exports:

```sh
node examples/editor-api-consumers/word-roundtrip-check.ts /path/to/disposable-directory
```

It verifies preserved controls, locks, hyperlinks, comments, replies, and revisions after Word serialization.
It then accepts revisions through editor-api and checks save/reopen.
Open `contract-word-then-api-accepted.docx` in Word to verify the final layout and accepted text.
This manual check does not run in CI or execute native Office.js calls.
