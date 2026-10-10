# Public API consumer agents

These deterministic agents execute document action plans using public editor-api imports. They create their input fixtures, save edited DOCX files, reopen them, and assert targeted edits and preserved content. No LLM credentials are needed.

## Run the example

From the repository root, run:

```sh
bun install
bun run build:packages
bun run --filter '@docx-editor-examples/editor-api-consumers' typecheck:published
bun run --filter '@docx-editor-examples/editor-api-consumers' contract
bun run --filter '@docx-editor-examples/editor-api-consumers' report
bun run --filter '@docx-editor-examples/editor-api-consumers' report:browser
REPORT_VERIFY_DOCX=/tmp/editor-api-consumers/report/browser/report.docx bun examples/editor-api-consumers/report-agent.ts
```

The contract command covers the server and the real browser host in Happy DOM. The report browser command uses Playwright Chromium, which must be installed (`bunx playwright install chromium`). It saves a screenshot and checks loaded collection navigation. The final command verifies browser-produced bytes through the server app's complete preservation assertions. All artifacts are disposable and written under `/tmp/editor-api-consumers/`.

`report-agent.ts` demonstrates explicit font-backed server pagination. It loads the repository's Carlito font files and disposes shaping resources after the runtime; callers outside this repository should supply their own font paths. The browser gets measured pagination from the configured editor.

The `*-feedback.md` files record historical findings and rerun results. See [Consumer review](../../openspec/changes/agent-editing-subset/consumer-review.md) for fixes and remaining runtime differences.

The default `typecheck` uses workspace source exports and runs before builds in CI. `typecheck:published` uses built declarations and runs after package builds in CI.

## Test published package exports

The contract and table workflows test public package exports and preserve their original assertions from the independent review:

```sh
bun run --filter '@docx-editor-examples/editor-api-consumers' test:published
```

This command uses Node 24 or newer after package builds to test the same exports a package consumer receives. It also runs in CI after the build. Node ignores workspace TypeScript aliases. Ordinary Bun execution in this workspace resolves source aliases. See `fresh-contract-feedback.md` and `fresh-tables-feedback.md` for the blind findings, fixes, remaining explicit batching limits, and the scope of the developer-experience score.

## Manual Microsoft Word round trip

1. Generate the contract fixture with `test:published`.
2. Copy `contract-pending.docx` into a temporary directory.
3. Open the copy in Word. Append ` — WORD CHECK` to `SERVICE AGREEMENT`, and verify undo and redo.
4. Save the document with tracked changes pending.
5. Run the checker against built package exports:

```sh
node examples/editor-api-consumers/word-roundtrip-check.ts /path/to/disposable-directory
```

It verifies preserved controls, locks, hyperlinks, comments, replies, and revisions after Word serialization. It then accepts revisions through editor-api and checks save/reopen. Open `contract-word-then-api-accepted.docx` in Word to verify the final layout and accepted text. This manual check does not run in CI or execute native Office.js calls.
