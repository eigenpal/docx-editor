# Fresh contract consumer evaluation

## Blind scope and method

I started from public editor API docs, its README, and built TypeScript declarations.
I read the applicable root `CLAUDE.md`.
I did not read implementation, tests, OpenSpec, previous consumer apps, or previous reviews before reproducing these findings.
Public imports execute workspace source through the existing Bun resolver. I did not inspect that source during blind testing.

The fixture models a service agreement with tagged fields, locked references, payment terms, and confidential text.
The consumer fills fields, assigns a hyperlink, creates a comment thread, proposes tracked text, and accepts revisions after reopening.
It independently verifies untouched text, field metadata, links, comments, locks, and accepted text.
Fixtures are constructed before opening. Saved outputs are never patched.

Run all probes:

```sh
bun examples/editor-api-consumers/fresh-contract-agent.ts
```

Pass a probe name to run one reproduction.
Failures save input XML, actual XML, and actual DOCX in `join(tmpdir(), 'fresh-contract-agent')`.
On this machine, that directory is `/var/folders/p_/82y9fw7x0jz_zrx42bvrpq5c0000gn/T/fresh-contract-agent`.

## Blind findings

### P1: Unlocking erases content-control metadata

Reproduction: `tagged-control-roundtrip`.

Load the `reference` control, set both lock flags false, then sync.
Load `tag,title,id` again. All three values become empty strings.
Expected: `reference`, `reference`, and `12` remain intact.
The control's value replacement succeeds through the existing proxy.
However, later lookup by its original tag fails with `ItemNotFound` after save/reopen.
The complete `contract-workflow` stops at that lookup.
The saved XML records the metadata loss.

### P2: A comment edge proxy cannot queue an ordinary property load

Reproduction: `comment-getfirst-load`.

Create and sync a comment. Then call `document.comments.getFirst().load('text')`.
The `load()` call throws `InvalidObjectPath` before the next sync.
Expected: the property read queues and resolves after `context.sync()`.
This contradicts the documented read-derived proxy pattern used by paragraphs and content controls.
Loading the collection first and selecting `items[0]` works.

### P1: A partial hyperlink update changes characters outside its range

Reproduction: `hyperlink-partial-retarget`.

Set `support portal` to `https://example.com/original`, then sync.
Set only `portal` to `https://example.com/updated`, then sync.
Read hyperlinks for `support` and `portal` separately.
Both report the updated URL.
Expected: `support` retains the original URL.
The declaration promises link writes over exactly the requested characters.
The saved XML confirms the whole wrapper was retargeted.

### DX friction: Batched replies conflict

Reproduction: `comment-aliased-replies`.

Queue two replies to the same existing thread through separate proxies, then sync.
The batch refuses with `ConflictingChanges` and a paragraph-focused explanation.
Docs describe conflicts for structural edits sharing a paragraph.
Replies need a clearer limitation or support for natural independent append operations.
I do not count this as silent data corruption.

## Successful blind probes

- Lock writes through two aliases preserve both requested lock flags.
- Unlock and content replacement can share one sync.
- A returned replacement range supports a later hyperlink assignment.
- Unsupported tracked formatting rolls back text and tracking mode together.
- A failed locked edit rolls back unrelated edits and permits a fresh read and edit.
- Rejecting a tracked replacement restores the original payment term.
- Independent replacements were initially queued successfully; the complete workflow later revealed offset corruption.

The first draft used `Body.comments`, which does not exist.
This was a consumer mistake. The declarations correctly expose `Body.getComments()` and `Document.comments`.
It is not an API bug.

## 9/10 developer-experience criteria

This is a bounded assessment, not proof of a universal subjective score.
A 9/10 result requires all material correctness gates and at least nine of these ten criteria:

1. Public imports and declarations support installation and compilation.
2. The main documented workflow finishes without source inspection.
3. Targeted mutations preserve content and metadata outside their targets.
4. Save/reopen preserves all edited semantics.
5. Read-derived proxies follow a consistent load/sync pattern.
6. Independent reads and writes support practical batching.
7. Aliases preserve identity and cumulative edits.
8. Typed errors explain the failure and permit safe recovery.
9. Supported host limits and required sync boundaries are discoverable.
10. The consumer produces inspectable output and explicit assertions.

Blind result: the 9/10 threshold is not met.
Criteria 2–5 fail on concrete reproductions. Criterion 6 has reply-batching friction.
The successful rollback and tracking checks provide strong evidence for criterion 8.
Browser behavior is not claimed by this server-only probe set.

## Transition after blind reproduction

The parent requested implementation repair after reading these independent reproductions.
At this point, I may inspect review model source and add regression tests.
The original consumer probes remain unchanged in their required behavior.

## Further workflow finding

After the control fix, the main workflow exposed a separate P1 text-batching defect.
Two replacements shared one paragraph and one sync.
The signer replacement changed the date target's offsets before the date replacement ran.
Actual text: `Signed by Ada Lovelace o13 September 2026}}.`
Expected text: `Signed by Ada Lovelace on 13 September 2026.`
The parent assigned this defect to the text-batching owner.
The original workflow assertions continue to require the correct complete sentence.

## Implemented repair and current validation

The review model now resolves handles during queued operation planning.
This fixes comment property loads, comment ranges, replies, decisions, and note body navigation.
`NoteItem.getNext()` also waits for its kind read before listing the next note.
Previously, endnote traversal could incorrectly use the default footnote kind.
Twelve scoped runtime tests pass, including the existing dependency suite.

Partial hyperlink edits now split ordinary text links through the existing canonical split function.
Unselected pieces preserve their original target, wrapper metadata, and run formatting.
Complex or nested wrappers and collapsed positions inside links refuse with `NotSupported`.
Twenty-two core link tests pass, including metadata preservation and save/reopen regressions.
The original partial-link consumer probe passes with its original semantic assertions.

The reply probe now handles `ConflictingChanges` explicitly.
It verifies that the refused batch wrote nothing, then queues each reply separately.
Deleting a reply and resolving its thread also need separate syncs.
These are recorded limitations, not hidden output repairs.

All results above use workspace source aliases through ordinary Bun execution.
Built-package validation requires the published-import TypeScript override.
The parent will rebuild and run that validation separately.
The script exits nonzero if any semantic probe fails.

The metadata investigation found noncanonical property order in the constructed control fixture.
The parser accepted the document and exposed those properties through supported reads.
The write fix preserves that generic property container instead of replacing it with empty metadata.
The fixture remains unchanged so this preservation contract stays exercised.

Final source checkpoint: all 11 consumer probes pass.
The complete contract workflow now saves pending and accepted DOCX files and verifies both reopen stages.
The combined runtime and hyperlink validation run passes 114 tests across six files.
Scoped lint reports no errors in the repaired runtime and store files.
The shared planner passes its line-cap gate after the text-ledger changes.

## Cross-review of other changes

I reviewed scoped and nested table reads, table-value formatting, generic control properties, list batching, nullable loads, and text rebasing.
I also reviewed the source/published TypeScript configuration and the CI build order.
I made no edits to those peers' source during this review.

Evidence:

- Sixteen scoped table, font, control, and list tests pass.
- Nineteen nullable-load and text-batching tests pass, including browser checks.
- An independent empty-body paragraph null-object load succeeds.
- Twenty-four independent edit permutations preserve text and returned ranges at replacement boundaries.
- Editor API source typechecking and consumer source typechecking pass.
- The line-cap gate passes.

I found no open concrete P2-or-higher issue in that reviewed scope.
Built-package validation remains a separate parent-run check.
These results support the tested server workflow; they do not prove universal 9/10 usability.
Reply batching remains the stated limitation.

## Final source-informed retest and rubric

My scoped retest assessment is **9/10 for the tested server contract workflow**.
This is reviewer judgment, not a measured success rate or universal usability claim.
The original blind assessment remains below the threshold.
This retest follows source investigation and repairs, so it is not a second blind evaluation.

| Criterion                          | Final assessment     | Evidence                                                                                             |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. Public imports and declarations | Pass                 | Source typechecks pass. The parent reports successful Node runs against rebuilt packages.            |
| 2. Main documented workflow        | Pass on retest       | The original contract workflow completes through public imports without output repair.               |
| 3. Target preservation             | Pass in tested scope | Targeted text, formatting, link metadata, control metadata, and neighboring text remain correct.     |
| 4. Save/reopen semantics           | Pass                 | Pending and accepted contracts reopen with the asserted review state and document content.           |
| 5. Consistent load/sync            | Pass in tested scope | Read-derived review objects and optional scalar loads pass regression tests.                         |
| 6. Practical batching              | Partial              | Plain text edits compose. Replies and some complex edits still require separate syncs.               |
| 7. Alias identity                  | Pass                 | Lock-axis aliases combine correctly. Comment aliases preserve the same thread.                       |
| 8. Typed failure and recovery      | Pass in tested scope | Refused edits preserve the batch and permit fresh reads and supported retries.                       |
| 9. Discoverable supported limits   | Pass on retest       | Updated docs explain prompt restrictions, endpoint semantics, and complex-operation sync boundaries. |
| 10. Inspectable output             | Pass                 | The consumer saves DOCX artifacts and asserts their reopened semantics.                              |

The final focused review found two additional concrete issues before completion.
Repeated paragraph-start inserts needed their original endpoint ordering.
Placeholder insertions also needed correct landing positions or an atomic refusal.
Both fixes now pass independent checks.

The latest focused run passes 36 replacement, text-batching, and lifecycle tests.
Six additional prompt-boundary cases verify correct starting ranges or atomic refusal.
The original placeholder reproduction now preserves metadata and survives reopening.
Hyperlink/bookmark replacements and permanent/temporary block-control replacements also pass independent checks.
Four authored `TrackMineOnly` prompt insertion/replacement cases return the exact inserted range text.
All 11 contract probes and the source typecheck pass after these changes.

The parent reports 11 contract probes and 20 table probes passing through Node against rebuilt packages.
That built-package evidence is attributed to the parent, not to my source-alias runs.
I found no open concrete P2-or-higher issue in this final reviewed scope.
Browser usability and arbitrary DOCX structures remain outside this numerical assessment.
