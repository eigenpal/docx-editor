# Second extensive review

This review follows the fresh consumer review and the initial PR checks.
The root reviewer inspected text preservation, runtime queue ownership, errors, docs, and Word round trips.
An independent high-reasoning reviewer inspected structural editing and cross-reviewed the queue fix.
See `round2-structural-review.md` and `round2-queue-cross-review.md` for independent findings.

## Confirmed findings and fixes

| Finding                                                                           | Severity | Fix and evidence                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setters queued during asynchronous prerequisite reads could join an earlier sync  | P2       | Capture detaches coalesced property bags before reads yield. Identity-based cleanup preserves later bags. Seven regression tests cover formatting, structural setters, and failed-batch recovery. |
| Header list formatting could affect shared main-body or footnote numbering        | P2       | Enumerate actual story roots and read namespace-qualified membership. Refuse cross-story sharing before mutation, including locked content.                                                       |
| List formatting could affect locked paragraphs through inherited styles           | P2       | Refuse formatting when a style references the addressed list instance. Cover main-body, footnote, and same-story inheritance.                                                                     |
| Gridless table column edits threw raw JavaScript errors                           | P2       | Refuse unsupported column topology with a stable public error. Whole-table deletion remains available.                                                                                            |
| List restart removed unrelated override metadata                                  | P2       | Preserve unrelated override children and leaf attributes while replacing authored numbering values.                                                                                               |
| Unsafe partial placeholder replacement returned a different error than documented | P3       | Return `NotSupported` for prompt-consuming position mismatches. Keep unrelated replacement errors unchanged.                                                                                      |

Regression tests verify refused operations preserve document bytes.
Structural browser tests cover undo/redo for pictures, fields, page setup, and existing list formatting.
A 72-case text matrix covers Replace/Before/After with ordinary text, emoji, combining marks, and tabs.
It exercises plain and split runs, hyperlinks, inline controls, bookmarks, and existing tracked insertion wrappers.
Every matrix case must succeed, preserve wrapper metadata, and retain exact text after save/reopen.
The matrix does not treat unexpected refusals as success.

## Local Microsoft Word verification

Verified disposable documents in local Microsoft Word on 2026-09-13.
No inspected file displayed a repair prompt.

- Report: four-row table values, header formatting, cell shading, nested lists, image recognition, and final sentinel.
- Structural report: portrait first page, landscape appendix, table, visible blue inline image, header, and two-page layout.
- Page fields: the appendix and footer displayed page 2; the total-page field displayed 2.
- Pending contract: populated controls, targeted signer/date edits, hyperlink, tracked insertion/deletion, and confidential sentinel.
- Review thread: resolved comment, reply text, and Word's reopen-thread action were visible.

The pending contract also completed a true Word serialization round trip:

1. Open the API-generated contract in Word.
2. Append ` — WORD CHECK` to its title using native Word editing.
3. Undo the edit, verify its removal, redo it, and verify its return.
4. Save in Word. The package changes from 2,424 bytes to 16,691 bytes.
5. Read the Word-saved package through built editor-api exports under Node.
6. Verify the native edit, controls and locks, hyperlink, resolved comment, reply, and pending revisions.
7. Accept revisions through editor-api, save, and reopen through editor-api.
8. Open that result in Word. Confirm accepted text, retained title marker, hyperlink, and resolved-comment marker.

The permanent checker is `examples/editor-api-consumers/word-roundtrip-check.ts`.
Its README documents the manual preparation steps.
Disposable evidence files are under `/tmp/pr811-word-round2/`; they are not committed fixtures.
Saving the unedited report and structural fixture did not change their bytes.
Those two checks establish Word rendering, not a Word serialization round trip.
Native Office.js execution was unavailable because no document-control session was connected.
This review does not claim exhaustive runtime equivalence with native Office.js.

## Validation

- The final full local suite passed 13,100 tests across 1,049 files, with zero failures.
- Workspace typechecks and core/editor-api builds passed.
- Both fresh consumer apps passed under Node against built exports.
- The Word round-trip checker passed against those built exports.
- The Chromium report app passed with no console errors. Its saved file passed server preservation checks.
- Documentation parsing, neutral-lane checks, and strict OpenSpec validation passed.
- Structural follow-up passed 16 tests, including three inherited-style refusals and one positive namespace/instance case.
- The independent broader structural run passed 72 tests.
- API checks, parity, licenses, formatting, and lint passed. Lint has zero errors and 97 existing warnings.

The final cross-review found no open concrete P2-or-higher finding in this reviewed scope.
The final source adds 95 regression cases across four new test files.
This result does not guarantee the absence of undiscovered defects.
Signature coverage remains informational: 81/81 fixed-profile members and 88/969 broad editing members.
Signature equality does not establish behavioral compatibility.

## Clean CI follow-up

The first CI run exposed a test-only import that resolved to unbuilt package output.
Runtime tests use a nested TypeScript configuration without the package self-alias.
The new cross-review test now imports the public source entry point by relative path.
All 95 new regressions pass with editor-api build output temporarily removed.
The built-package consumer apps retain their package imports and still run after builds in CI.
