# Design

## Architecture and dependency order

1. Freeze the 81-member target and its pinned upstream signatures. Record each parameter domain, returned proxy, and runtime limitation.
2. Establish baseline workflow tests for existing text, formatting, targeting, review, and controls.
3. Extend canonical operation planning and protocol validation. Reuse store operations; extract shared host-neutral helpers from browser commands where needed.
4. Add proxy hydration, addressing, collections, and pending-object resolution before exposing new editing methods.
5. Add missing formatting and control creation, lists, tables, images, breaks, page furniture, and fields.
6. Run round-trip workflows on both hosts, inspect uncertain results in local Word, then reconcile reports and documentation.

The canonical store remains the only write path. Package parts, relationships, and nodes must commit atomically.
New operations participate in protocol validation, capability reporting, tracking policy, lock checks, conflict detection, and stable error mapping.
No DOM, browser command dispatch, or duplicate document model enters the headless implementation.

## Addressing and batches

Inserted objects need usable pending proxies. Test insert then configure both within one sync and across syncs.
Document explicitly where an intermediate sync is required by the supported runtime; do not claim full Office.js batching parity if refused.
Collection item identity survives unrelated edits; deletion and stale handles produce stable errors.
Test multiple writes on one object, writes through separate aliases, dependent structural operations, failed batches, and subsequent recovery.
Snapshot-based planners must not silently overwrite earlier writes with old property bags.

## Public contract and runtime domains

Match the pinned Office.js member signatures, including enum alternatives, optional arguments, return objects, and writable types.
A bounded runtime domain is a documented behavioral limitation; it does not justify silently narrowing or changing the upstream signature.
For example, `Range.insertTable` accepts Before/After, not the full text-insertion location set.
List numbering format arrays refer to level indexes; indents use points and the marker indent is relative to text indent.
Existing signature differences in the original 44 members require review too; adding only the 37 absent names is insufficient.

## Bounded semantics

- Text: explicit supported insert locations; duplicate search matches; paragraph boundaries and Unicode offsets.
- Font: underline off/single and supported styles, explicit false values, highlight clearing, and mutually exclusive subscript/superscript. Preserve unrelated direct formatting.
- Lists: new numbering definitions, attachment by list ID, nine levels, bullets/decimal formatting, starts, indents, and detachment. Define shared-definition effects and restart scope.
- Tables: rectangular topology, exact value dimensions, insertion/deletion indexes, header prefixes, styles, cell width/shading/alignment. Required traversal includes tables, rows, cells, and cell bodies. Refuse unsupported merged/nested mutation before changing content.
- Controls: wrap the intended range, assign stable IDs, handle plain/rich types, and enforce both lock axes including ancestors. Do not flatten surrounding bookmarks or controls.
- Pictures: bounded base64 PNG/JPEG decoding, media/relationship allocation, points-to-EMU dimensions, aspect lock semantics, alt text escaping, and shared relationship preservation on deletion.
- Breaks: page and next-page section breaks, insertion locations, section-property ownership, and header/footer inheritance.
- Page furniture: access/create missing primary header/footer parts using the Office-shaped section/body path. Preserve linked and first/even variants; explicitly document limitations.
- Fields: PAGE and NUMPAGES only for evaluation. Define `code` parsing, field identity, cached result replacement, and save/reopen behavior. Never execute arbitrary field instructions. A dirty flag alone is not a successful `updateResult()` computation.
- Review: Off and TrackMineOnly with explicit author; verify revision records and original/final text. Never disable tracking to permit another operation.

## Metrics

The 81-member denominator is fixed for this profile. Supporting reads and host functions remain required but do not inflate it.
Report declaration presence, exact upstream signature match, and tested behavior separately.
Each member has explicit runtime notes and evidence; passing a refusal test is not supported behavior.
Workflow readiness is passed named workflows / total named workflows, with separate browser/headless results.
Do not label either metric full Office.js compatibility.
The exhaustive checker remains a separate informational report; integrate with PR #803 without duplicating its inventory.

## Verification

Use synthetic fixtures with sentinel text, styles, bookmarks, unrelated parts, and shared relationships.
For each group, test positive edits, invalid inputs/targets, locks/tracking refusals, and preservation after save/reopen.
Inspect canonical XML and semantic content; a successful promise or screenshot alone is insufficient.
For ambiguous behavior, open a generated disposable fixture in local Microsoft Word. Record app version, fixture, steps, expected/observed results, and saved artifact evidence.
Word UI checks establish document behavior, not Office.js invocation semantics. Use pinned signatures and official API documentation for that contract.
Do not change the user's open documents. Keep unresolved Word observations explicit.

## Delivery

One implementation PR, an additive changeset, updated API snapshots and compatibility notes, and short CLAUDE usage guidance.
Run scoped tests during implementation and required repository gates before publishing.
Repeat self-review after fixes. Check tasks only with linked source/test evidence; leave unsupported or unverified work unchecked.

## Independent consumer-app review after implementation

Multiple subagents will independently implement executable agent-style applications against public editor-api package exports.
They must use documented open/save host APIs, not internal automation operations, private model imports, or browser command fallbacks.
Assign distinct ordinary-document tasks: contract/template revision, report authoring with lists/tables/images, and page furniture/fields.
Each app must perform real edits, save, reopen, and assert document results. Capture compile failures, runtime bugs, missing navigation, unclear errors, and batching problems.
Combine their feedback into one tracked findings log. Fix required API gaps, add regression coverage, and rerun each affected app.
Then run an independent reviewer loop on the final diff and evidence. Unresolved required behavior prevents opening the PR.
Local Word provides additional document verification where semantics or rendering remain uncertain.
