# Fresh report consumer evaluation

The first attempt used only public documentation, built declarations, and public imports. I read the applicable `CLAUDE.md` first. I did not read implementation, tests, prior consumers, reviews, or OpenSpec before running. The script creates its own DOCX input with `fflate`. It never patches output XML.

Run `bun examples/editor-api-consumers/fresh-tables-agent.ts` from the repository root. The script writes `/tmp`-equivalent `fresh-tables-report.docx` and prints each result. Failed assertions give a nonzero exit code.

## Blind findings

### P2: Cell body font reads return null for directly formatted text

Create a two-cell table after a normal paragraph. Format the first cell through its body:

```ts
const cell = table.getCell(0, 0);
cell.body.font.bold = true;
cell.body.font.color = '#143B52';
await context.sync();
cell.body.load('text');
cell.body.font.load('bold,color');
const paragraph = cell.body.paragraphs.getFirst();
paragraph.font.load('bold,color');
await context.sync();
```

Observed: body text is correct, but body bold and color both return `null`. The paragraph returns `true` and `#143B52`. Saved XML contains the correct direct run formatting. Expected: both font objects report the same directly authored values. Impact: report validation falsely reports missing formatting. Formatting decisions can use incorrect values.

The script includes an isolated reproduction: `isolate cell body font read against paragraph read`. The header assertion exposes the same read defect. Structural edits preserve the header formatting. After this read defect was fixed, the value-replacement assertion exposed a separate formatting loss.

### P2: List batching rules are stricter than the public documentation

After creating and syncing a list, this same-level batch fails:

```ts
list.setLevelNumbering(0, 'Arabic', [0, '.']);
second.attachToList(list.id, 0);
await context.sync();
```

Observed: `ConflictingChanges` says two changes affect the same paragraph. The list formatting targets an existing list. The attachment targets a different paragraph. Expected: this natural batch succeeds, or public documentation identifies the required boundary. Public documentation warns about different list levels and structural edits sharing a paragraph. It does not identify this broader list formatting restriction.

This batch also fails after the required insertion sync:

```ts
list.setLevelBullet(1, 'Custom', 0x2022, 'Calibri');
detail.listItem.level = 1;
await context.sync();
```

The first report run retained default bullets and omitted one action's list membership. The writes refused atomically. Earlier successful creation batches remained, as expected. The script preserves both natural batches and their isolated reproductions.

## Working behavior

- Read-derived title formatting works in one sync.
- Table insertion, row insertion, and column insertion work.
- Returned row collections resolve after insertion sync.
- Cell shading, vertical alignment, and column widths survive structural edits.
- Table row and column deletion preserve the remaining values.
- Reloaded table and row collections report new membership.
- Existing row and cell proxies retain identity after preceding row insertion and deletion.
- Inline picture insertion, locked resizing, and alternative text work.
- Contradictory locked dimensions refuse atomically, including an independent title edit.
- The same `run()` recovers after the refusal and accepts a valid resize.
- Public text, table, image, and paragraph metadata survive save/reopen.

## Developer experience rubric

A 9/10 result needs all documented report operations to work without source inspection. It permits minor missing examples. It does not permit incorrect reads or undisclosed batch restrictions.

| Category                           | Weight | Blind score | Evidence                                                             |
| ---------------------------------- | -----: | ----------: | -------------------------------------------------------------------- |
| Setup and public discovery         |      2 |         1.5 | Imports work. Declarations provide most table and list details.      |
| Predictable load/sync behavior     |      2 |         1.1 | Tables work. Natural list batches need undisclosed boundaries.       |
| Correct reads and preserved output |      3 |         2.0 | Save/reopen works. Cell body font reads are incorrect.               |
| Errors and recovery                |      2 |         1.6 | Atomic recovery works. List conflict messages misidentify the scope. |
| Task completeness                  |      1 |         0.8 | The report pipeline works except expected list composition.          |
| Total                              |     10 |         7.0 | The blind experience does not meet 9/10.                             |

Other friction: collection property paths require two reads, as documented. Table authoring appears only in declarations and the compatibility matrix within the dedicated documentation. A compact table/list recipe would reduce declaration browsing.

## Source inspection transition

After the blind reproduction, the parent authorized source inspection and a focused font-read fix. `scopedStoryReads` retains whole-story indexes while exposing a cell's paragraph array. `spanParagraphIds` slices that scoped array with whole-story indexes. This explains the incorrect null aggregation. The fix and its regression test are separate from the consumer script.

## Additional confirmed findings after source inspection

### P2: Value replacement removes direct cell font formatting

Set a plain cell's body font to bold, then assign new text through `table.values` or `cell.value`. After sync and save/reopen, the replacement text has no direct bold value. Cell shading remains intact. Expected: ordinary value replacement preserves the existing font formatting. The implementation deleted every original character before inserting replacement text. The replacement therefore had no original run properties to inherit.

### P2: Existing nested-table cells cannot resolve their parent table

For an existing rectangular nested table, this navigation fails:

```ts
const outer = context.document.body.tables.getFirst().getCell(0, 0).body;
const nestedCell = outer.tables.getFirst().getCell(0, 0);
nestedCell.body.insertText('updated', 'Replace');
await context.sync();
```

Observed: `InvalidObjectPath` names the nested cell body. Expected: update that cell and preserve the neighboring cells. The internal parent lookup searched only top-level tables. This differs from nested table insertion, which explicitly refuses as unsupported.

## Retest after fixes

All 20 consumer stages pass with source package resolution. The original list batches remain unchanged in the consumer. The source fixes preserve direct cell formatting and resolve existing nested cells. Regression tests cover save/reopen, neighboring-cell isolation, and atomic complex-cell refusal. Cell body Start/End targeting passed after resolving the deferred body. No separate endpoint-targeting defect was confirmed.

The retest uses:

```sh
bun --tsconfig-override tsconfig.json examples/editor-api-consumers/fresh-tables-agent.ts
```

The consumer still uses public import names. The override resolves them to workspace source. This Bun version prints a directory-mismatch diagnostic with that override, but executes the program successfully. The normal command must also pass after rebuilding the public packages.

Functional score after these fixes: 9.1/10 using the same rubric. The component scores are 1.5, 1.8, 3.0, 1.8, and 1.0. The remaining deductions concern declaration browsing and additional documented sync boundaries. This score covers the tested report workflow, not every Office.js operation.
