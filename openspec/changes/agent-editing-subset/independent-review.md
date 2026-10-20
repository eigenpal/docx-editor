# Independent implementation review

Scope: canonical transaction behavior, resources, history, public proxies, protection, tracking, pagination, and compatibility evidence.
The parent applied the initial production fixes.
At the parent’s request, this reviewer also fixed the final control-alias issue below.
The final review has no open required-scope findings.

## P2: Table authoring leaves deleted comments in the package

Status: fixed by the parent and independently verified. No required finding remains open.

Reproduction uses only the public server runtime:

```ts
const table = context.document.body
  .getRange('Start')
  .insertTable(2, 1, 'After', [['COMMENT TARGET'], ['KEEP ROW']]);
await context.sync();
const range = table.getCell(0, 0).body.getRange();
await context.sync();
range.insertComment('Comment on deleted table');
await context.sync();
table.deleteRows(0, 1);
await context.sync();
```

Expected: the deleted row's comment disappears from both the model and saved package.
Initial actual result: the model lists zero comments, but `word/comments.xml` retains the complete comment record.
The initial artifact retained the comment author and text without an anchor.

Evidence:

- Reproduction script: `/tmp/independent-table-comment-repro.ts`.
- Saved package: `/tmp/review-table-comment.docx`.
- The original saved comment text was `Comment on deleted table`.
- After the fix, the same reproduction saves an empty `w:comments` root.
- XML inspection used Python `zipfile` only for reading.

Cause: `authorTable` wraps cell and structural edits in one canonical operation.
`TreePackageStore.transact()` previously omitted this wrapper from `CONTENT_REMOVING_OPS`.
The previous package cleanup gate missed removed comment anchors.
The parent also enabled note cleanup for content-removing operations.

Fix recommendation: classify content-removing table authoring for comment and note cleanup.
Retain atomic failure, unrelated comments, and history restoration.
Cover table deletion, row/column deletion, and cell-value replacement where supported.

Regression verification: `packages/editor-api/src/model/__tests__/model-table-cleanup.test.ts`.
The test uses only public editor-api/core/pro imports and `fflate` fixture construction.
It verifies row, column, and whole-table deletion through server and browser hosts.
Each case removes associated comment records and footnote bodies from saved XML.
Comments and notes in surviving cells and outside the table remain intact.
Browser undo restores the full public snapshot, including deleted notes and comments.
Save/reopen preserves that restoration. Redo reapplies the exact cleaned result.
Result: six tests passed, zero failed, 96 assertions.
The normal focused `bun test` command passes without a configuration override.
The editor-api package TypeScript check also passes.

The original reproduction also passed independently after the fix.
Its saved `comments.xml` now contains an empty comment collection.

## P1: Browser suggesting admission needed an explicit structural guard

Status: the parent added the guard. Corrected public-runtime reproduction verifies refusal.

Source review found two bypass paths:

- List authoring can supply package edits with no tree operations.
- New authoring operations can pass through tracked-operation conversion without a tracked representation.

These paths required admission before package allocation when the browser UI suggests changes.
The parent added `port.suggesting()` and reused the supported tracked-operation policy.

The corrected reproduction sets `editor.setEditingMode('suggesting')` and checks `editor.getEditingMode()`.
The API runtime retains its initial `Off` mode.
List, table, PAGE field, and plain-control insertion each return `NotSupported`.
Their targets identify the corresponding public operation.

Evidence: `/tmp/independent-review-repro.ts`.

Important evidence correction: the initial script used internal spelling `suggest` through the public method.
That spelling was invalid. Its initial successful writes do not prove the original suggesting-mode behavior.
The finding rests on source review; the corrected script establishes post-fix refusal.
The initial `/tmp/review-suggest-*.docx` artifacts must not support a suggesting-mode claim.

## Verified transaction and proxy boundaries

Command:

```sh
bun test \
  packages/editor-api/src/runtime/__tests__/runtime-read-dependencies.test.ts \
  packages/editor-api/src/model/__tests__/model-field-pagination.test.ts \
  packages/core/src/automation/__tests__/list-history.test.ts \
  packages/editor-api/src/model/__tests__/model-control-creation.test.ts
```

Result: 14 tests passed, zero failed, 51 assertions.

This run checks:

- Read prerequisites and final writes use one committed transaction.
- A failed final command leaves writes unapplied.
- A concurrent writer produces stale refusal without replay.
- Write-created dependent proxies refuse before producer commit.
- Asynchronous resource preparation pins the initial write revision.
- Failed prerequisite cleanup permits a later deliberate retry through the same proxy.
- Deferred formatting, page setup, and control creation work.
- List definition history survives undo/redo and later resource allocations.
- PAGE selects its line on multipage paragraphs and respects section numbering.
- Control unlocking respects ancestor protection.

A separate two-table insertion probe refused the second insertion with `ConflictingChanges`.
It did not silently return two aliases for one inserted table.
The runtime notes document solitary table insertion, so this is an accepted boundary.
The error text mentions a shared paragraph although the requested paragraphs differ.
This is error-message imprecision, not a lost-write finding.

## Pagination and public contract review

Headless pagination snapshots bind to a package revision.
Browser pagination snapshots bind to package identity.
The runtime pins resource preparation and final execution to the same revision.
Field-result updates refuse batches containing other writes.
These paths avoid silently evaluating results against a concurrently changed document.
The targeted pagination tests passed.

Table width writes update the grid, matching cell widths, total table width, and fixed layout.
The current runtime note states this broader effect explicitly.
The review found no additional required width defect in this path.

Compatibility percentages explicitly measure signatures and property-write types.
The report excludes reads and does not label signature matches as behavioral equivalence.
The fixed profile checks exactly 81 unique members and a complete area partition.
Runtime notes retain partial/different statuses and describe important batching limits.
Final checklist reconciliation remains the parent's delivery task.

## Consumer evidence

The contract consumer passes its full server plan and browser parity checks.
It covers 42 assertion sites, including protection/refusal/unlock/refill/save/reopen on both hosts.
Browser execution uses Happy DOM and does not prove native rendering.

The report consumer identified footer font writes and collection proxy issues.
The parent reports that these fixes pass its final rerun.
This reviewer did not duplicate that complete report execution.

Remaining ordinary workflow limitations include read-only comment text and generic lock refusal errors.
Those documented limitations do not require advanced structure support for this profile.

## P1: Partial lock writes through aliases lost earlier writes

Status: reproduced, fixed in the planner, and verified.

Create two distinct proxies for one initially both-locked content control.
Queue `aliasA.cannotEdit = false` and `aliasB.cannotDelete = false`, then sync.
Expected: both own flags become false.
Initial actual result: `cannotEdit` remains true, while `cannotDelete` becomes false.
Each partial write previously filled its omitted axis from the original snapshot.
The second alias therefore overwrote the first alias's change.
The same pattern could discard an earlier requested lock when starting from unlocked state.

The planner now stages own lock values by story plan and canonical control identity.
Each later partial write uses the staged value for its omitted axis.
Explicit complete lock values also update the staged value.
Canonical transaction validation still enforces ancestor locks and bound controls.
The staged values live only inside their batch planner.

Regression: `distinct control aliases combine lock axes in queue order and preserve ancestor protection`.
The test covers both unlock orders, combined locking from unlocked state, refill, and save/reopen.
Two aliases cannot unlock a child while its parent remains locked.

Verification:

```sh
bun test packages/editor-api/src/model/__tests__/model-control-creation.test.ts \
  packages/editor-api/src/runtime/__tests__/runtime-read-dependencies.test.ts
```

Result: 12 tests passed, zero failed, 56 assertions.
Package TypeScript and focused ESLint checks passed.
No required review finding remains open.
