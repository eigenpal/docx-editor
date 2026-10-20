# Plan self-review

Plan review date: 2026-09-12. Implementation and consumer verification are now recorded in `evidence.md`, `consumer-review.md`, and `independent-review.md`.

## Findings and corrections

1. **Presence was easy to confuse with completion.** The earlier 44/81 counted declarations, not successful tasks. All implementation checklist items start unchecked. Metrics distinguish signatures, presence, and workflows.
2. **Editing members lacked navigation dependencies.** Tables, cells, fields, pictures, and returned-object hydration now have explicit prerequisite tasks.
3. **Snapshot batching could lose writes.** The design now requires alias, pending-object, dependent-command, atomic failure, and recovery checks. Unsupported batching must have explicit notes.
4. **Page fields lacked an evaluation contract.** PAGE/NUMPAGES need a defined pagination context and persisted results. Dirty-only writes do not fulfill updateResult. Arbitrary field execution is prohibited.
5. **Header/footer access did not create missing parts.** Primary part creation, relationships, and inheritance are explicit requirements outside the 81-member denominator.
6. **Structural edits could damage preserved data.** Tests now require untouched sentinels, bookmarks, styles, relationships, locks, and unsupported structures to survive.
7. **List restart and shared numbering were ambiguous.** The design requires explicit restart scope and shared-definition effects, including nine-level bounds.
8. **Image units and resource lifetime were omitted.** The plan includes point/EMU conversion, base64 bounds, format validation, aspect-lock semantics, and shared-media preservation.
9. **Word UI evidence could overstate API conformance.** Word validates generated document behavior; pinned declarations and API documentation validate the Office.js contract.
10. **One percentage hid host differences.** Headless/browser workflow results remain separate. Browser fallbacks do not count as editor-api support.

11. **Runtime scope could accidentally change signatures.** The plan now distinguishes bounded behavior from public signature conformance. Existing differing members also require review. Range table insertion uses Before/After; numbering format arrays and relative indents require specific handling.

## Sources checked

- [Word Field API](https://learn.microsoft.com/en-us/javascript/api/word/word.field?view=word-js-preview): updateResult updates the field; no computation success claim follows from a dirty flag.
- [Word List API](https://learn.microsoft.com/en-us/javascript/api/word/word.list?view=word-js-preview): numbering format arrays reference level indexes; marker indent is relative to text indent.
- [Word Range API](https://learn.microsoft.com/en-us/javascript/api/word/word.range?view=word-js-preview): insertion methods have distinct location domains and return objects.
- Local reference: pinned @types/office-js 1.0.605 normalized inventory in the compatibility-checker worktree. The implementation extends reference-only conformance inputs; no upstream implementation is copied.

## Local Word verification

The first direct-open attempt timed out and did not verify a document. A later
Finder Go to Folder / Open route succeeded with the installed Microsoft Word 16.112.3.
Only disposable generated files were opened; existing user documents were not edited.

On 2026-09-12 the final report opened without a repair prompt. Native Word's
accessibility tree and screenshot showed nested bullets, numbering restarted at 2,
formatted headings and emphasis, a three-by-three table within the body width,
an inline image with the requested alt text, and the created header. The footer
contained distinct PAGE and NUMPAGES fields with “Page 1 of 1”; Word's status bar
also reported one page. An earlier inspection caught app-level table overflow and
inherited numbering; the public-API action plan now sizes columns and detaches
non-list paragraphs explicitly, and the reopened result is correct.

The contract `pending.docx` also opened without a repair prompt. Word rendered
replacement text 200 with a tracked deletion of 100 attributed to Contract Agent,
the targeted duplicate-text edit, the hyperlink and populated template text, and
the untouched sentinel. The Comments pane showed a resolved thread containing
“Please approve this limit.” and reply “Approved for review.” with a Reopen thread
button. This verifies generated DOCX rendering and review markup, not execution
of the 81 methods through native Office.js.

Inspected artifact hashes (SHA-256; regenerate with the checked-in consumer apps):

- `/tmp/editor-api-consumers/report/report.docx`: `f5018233627be93601f6f8c133a90804450ba1827c0890167d02c211d0248e5e`
- `/tmp/editor-api-consumers/contract/pending.docx`: `d8c44108cc7189e610edd039dc129db7cec3d41568caf166baab7ff090852467`

## Resolved design decisions

- PAGE/NUMPAGES use real measured pagination; server callers explicitly supply a
  measurer, and browser calls use the editor layout. Missing computation refuses.
  Font-backed multipage and section-numbering tests complement the native one-page check.
- Public insertion-location and enum domains match the pinned upstream signatures;
  narrower runtime domains and batching differences have per-member notes.
- Missing header/footer parts are created atomically with relationships, then
  populated through public APIs. Both hosts have save/reopen coverage.
- The checker originated in PR #803. This implementation reuses its tooling and
  full-inventory path, with a separate fixed-profile scope. Both summaries run in CI.
- OpenSpec validation checks document structure; behavioral evidence comes from
  source tests, independent consumer apps, and the bounded Word checks above.
