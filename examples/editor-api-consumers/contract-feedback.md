# Contract consumer agent

Run from the repository root:

```sh
bun run examples/editor-api-consumers/contract-agent.ts --browser
```

The parent consumer workspace supplies dependencies. Bun uses repository aliases for public package names. The app imports no private document APIs. Fixture ZIP construction uses `fflate` only before editing. The app never rewrites output XML. Artifacts go to `/tmp/editor-api-consumers/contract/`.

`executeContractPlan(runtime, plan)` separates agent actions from execution. Each action contains an exact quote and explicit occurrence selection where needed. The executor checks the expected match count before changing the document. The sample changes the second of three matching strings, including duplicates within one paragraph. All document proxies stay inside their `run()` callback.

## Results

The final run returned `PASS` with exit status 0. It completed these paths:

- Eight plan actions, with paragraph insertion/deletion, exact replacement, hyperlink, two controls, comments, and tracked replacement.
- Plain and rich control creation, tag/title assignment, filling, locking, and protected mutation refusal.
- Comment insertion, reply, resolution, reply deletion, and thread deletion.
- One grouped replacement revision, with individual accept/reject and collection acceptAll/rejectAll.
- Control deletion with both `keepContent` values, in an independent case without locks.
- Save/reopen assertions for the pending document and all four revision decisions.
- Original-view text reading for the same pending revision document.
- Browser host execution through public `createDocxEditor`, `reviewModule`, and `createBrowser` APIs.
- Browser save/reopen semantic parity against the server result.
- Preservation of duplicate sentinels and an unrelated named bookmark.

The file contains 42 assertion call sites. Four revision branches reuse several assertions. There are eleven DOCX artifacts and twelve JSON evidence artifacts. Browser coverage uses Happy DOM. It does not establish native rendering or Word compatibility. The browser run covers the plan and protected-control refusal, unlocking, refilling, and save/reopen. The decision and cleanup branches use the server host.

TypeScript passed with a temporary configuration extending the root configuration. This configuration includes this consumer and its public source dependencies. It disables unused-declaration checks only. Strict type checking remains enabled. Prettier completed for the consumer script.

## Fixed during review: unlocking a protected control

Initial severity: high. The initial build could not unlock a previously protected field. The parent fixed the production implementation after this consumer reported the failure. The unchanged lock sequence now passes on both hosts. Additional checks confirm refilling and save/reopen after unlocking. The script exits with status 1 if this failure returns.

Minimal reproduction, within a public runtime:

```ts
await runtime.run(async (context) => {
  const controls = context.document.contentControls.getByTag('client');
  controls.load('items');
  await context.sync();
  controls.items[0]!.cannotEdit = true;
  controls.items[0]!.cannotDelete = true;
  await context.sync();
  controls.items[0]!.cannotEdit = false;
  controls.items[0]!.cannotDelete = false;
  await context.sync();
});
```

Expected: both flags become false. The content and wrapper remain intact. Initial actual result: `GeneralException` with this duplicated target:

```text
document.contentControls.getByTag.items[0].document.contentControls.getByTag.items[0].cannotEdit
```

Current evidence: `locked.docx`, `unlocked.docx`, `browser-unlocked.docx`, and their snapshots. `run-result.json` records no outstanding semantic failures. The app removes stale `unlock-failure.json` before each run.

## Error clarity

Severity: medium. Protected filling and deletion return `GeneralException`. The error gives no stable distinction between protection and an unexpected engine failure. The guide provides no recovery action for this code. Both refused operations preserve the complete public semantic snapshot. Evidence: `lock-refusals.json`.

## Ordinary workflow gap

Comment text uses the public read-only `text` member. Office.js uses writable `content`, which this API intentionally does not expose. An initial consumer attempt to load `content` returned `InvalidArgument`. The app corrected its call after consulting the public member documentation. This is documented divergence, not an unexpected implementation failure. However, a reviewer agent cannot revise its own existing comment through this API. Deleting and recreating a thread can lose reply identity and conversation history.

## Sync boundaries

The app follows `packages/editor-api/OFFICE_JS_GUIDE.md`:

- Load collections before checking their items.
- Batch independent member-property loads before a single sync.
- Commit inserted proxies before configuring or using them.
- Re-anchor each separately reviewable action after previous edits.
- Commit final queued writes explicitly.

The eight actions use separate sync boundaries for review and fresh anchors. This is intentional. It is not evidence that all independent writes require separate transactions. The app batches control metadata and both lock flags. It does not make unsupported structural edits while tracking. It explicitly sets tracking only for the planned tracked replacement.

This consumer agent changed no production API files. The parent applied the reported unlock fix.
