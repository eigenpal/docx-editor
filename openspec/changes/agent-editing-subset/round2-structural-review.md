# Round 2 structural review

Date: 2026-09-13. Branch: `feat/agent-editing-subset`. PR: 811.

## Result

This review found and fixed three P2 defects. No P1 defect was confirmed.
The fixes add sixteen public consumer regression cases.
The review did not use earlier no-findings verdicts as evidence.

### P2: List formatting crossed story boundaries and bypassed content locks

- Source: `packages/core/src/automation/plan-list-authoring.ts`, the `setListLevelFormat` admission check.
- Trigger: A header and a main-body paragraph share numbering instance `1`.
- A footnote can replace the main-body paragraph in the same reproduction.
- Public operation: Resolve `section.getHeader('Primary').lists.getFirst()`, then call `list.setLevelStartingNumber(0, 99)`.
- Before the fix: The sync succeeds and changes the shared numbering definition.
- The change also affects the other story, including a content-locked paragraph.
- Cause: The check passed package roots to `storyParagraphs()`. Document and note package roots are not story roots.
- A separate namespace defect let foreign `x:val` hide the real `w:val` during the check.
- Fix: Enumerate `storyRootsOf(part)` and use the canonical, namespace-aware `listMembershipOf()` read.
- Validation: Four cases cover main-body and footnote sharing, with and without content locks.
- Every fixture includes a foreign `x:val` before the real numbering attribute.
- Each case now returns the existing public `InvalidArgument` refusal and preserves the saved package.
- Save/reopen confirms that the rejected counter value does not persist.

### Additional list-lock reproduction: Style-inherited membership

A follow-up review confirmed another path around the same list admission policy.
Three public probes cover locked main-body, footnote, and same-story paragraphs.
Each paragraph inherits numbering instance `1` through a `basedOn` style chain.
The list proxy names an ordinary direct member of that instance.
Before the fix, formatting the direct member's list changes the shared instance without checking inherited members.

The planner now refuses any addressed numbering instance referenced by a styles part.
This guard preserves the ordinary direct-membership subset without adding an incomplete second style cascade.
It checks namespace-qualified `w:numId` references, including references in base styles.
The public guide and all four list-format endpoint notes record this refusal, including references in unused styles.
A positive regression permits other numbering IDs and ignores foreign numbering elements and attributes.
The three save/reopen regressions preserve both the document and numbering definition after refusal.

### P2: Gridless column changes threw raw exceptions

- Source: `packages/core/src/store/store/table-authoring-plan.ts`, column mutation planning.
- Trigger: A rectangular two-cell table has no `w:tblGrid`.
- Public operations: `table.addColumns('End', 1)` and `table.deleteColumns(0)`.
- Before the fix: Both throw raw `TypeError` exceptions when reading an absent grid-column ID.
- Consumers cannot handle these exceptions through the documented stable error-code contract.
- Fix: Refuse column insertion and partial column deletion before grid-column access.
- Validation: Both operations now return `InvalidArgument` and leave the saved package unchanged.
- A separate save/reopen case confirms that deleting all columns still removes the table.

### P2: List restart discarded preserved extension data

- Source: `packages/core/src/automation/list-authoring.ts`, leaf replacement and level-override reconstruction.
- Trigger: An existing level override contains foreign metadata and a foreign attribute on `w:start`.
- Public operation: `list.setLevelStartingNumber(0, 4)`.
- Before the fix: Save/reopen loses both extension values.
- Cause: Restart reconstruction discarded all override siblings. Leaf replacement discarded all previous leaf attributes.
- Fix: Remove only the replaced `w:lvl` and superseded `w:startOverride` elements.
- Merge authored leaf attributes while preserving unrelated attributes and child nodes.
- Validation: Save/reopen retains both extension values and stores the requested starting number.

## Review scope

Read `CLAUDE.md` and the public tables, lists, pictures, fields, and page-layout guides.
Inspected model fixtures and the corresponding automation planners, canonical table operations, field operations, and story traversal.
The regression suite imports `DocxEditor` through the public server and browser package entries.
It uses the public editor entry for browser history commands.
Input helpers create DOCX fixtures. They do not repair saved output.

The additional browser cases cover picture insertion, field insertion, page orientation, and existing-list formatting.
Each case checks saved package data before the edit, after undo, and after redo.
Each case also reopens the final document through the public server API.

One exploratory assertion required list creation undo to remove every unused numbering resource.
That assertion failed because undo retains unused numbering definitions.
The review does not classify that resource retention as a P2 defect.
Existing-list formatting undo and redo restore the complete saved package data.

## Word inspection fixture

Created `/tmp/pr811-word-round2/structural.docx` from the public report-agent output.
The additional operations use public APIs and actual Carlito font measurement.

Expected results:

- Page 1 retains the report table, lists, and picture.
- Page 2 uses landscape orientation.
- Page 2 begins with `SECOND SECTION: wide appendix`.
- The body PAGE field displays `2`.
- The body NUMPAGES field displays `2`.

The original report footer cache remains unchanged.
The root reviewer owns Word inspection and the Word save/reopen check.

## Verification

All sixteen structural regression cases pass: 51 assertions.
The broader scoped run passes 72 tests across twelve files: 372 assertions.
The run covers these files:

- `packages/core/src/automation/__tests__/list-authoring.test.ts`
- `packages/core/src/automation/__tests__/list-history.test.ts`
- `packages/core/src/automation/__tests__/table-authoring.test.ts`
- `packages/editor-api/src/model/__tests__/model-round2-structural.test.ts`
- `packages/editor-api/src/model/__tests__/model-list-authoring.test.ts`
- `packages/editor-api/src/model/__tests__/model-tables.test.ts`
- `packages/editor-api/src/model/__tests__/model-table-parity.test.ts`
- `packages/editor-api/src/model/__tests__/model-table-cleanup.test.ts`
- `packages/editor-api/src/model/__tests__/model-pictures.test.ts`
- `packages/editor-api/src/model/__tests__/model-fields.test.ts`
- `packages/editor-api/src/model/__tests__/model-field-pagination.test.ts`
- `packages/editor-api/src/model/__tests__/model-page-breaks.test.ts`

Commands:

```sh
bun test packages/editor-api/src/model/__tests__/model-round2-structural.test.ts
bun run --filter '@docx-editor.dev/editor-api' typecheck
bunx eslint packages/core/src/automation/plan-list-authoring.ts packages/core/src/automation/list-authoring.ts packages/core/src/store/store/table-authoring-plan.ts packages/editor-api/src/model/__tests__/model-round2-structural.test.ts
```

The package typecheck and scoped ESLint checks pass.
Prettier formatted all owned changed files.
The root reviewer owns full repository gates and the shared changeset.
No commit or push was performed.
