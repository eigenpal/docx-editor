# Table Editing Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make table colors use the full Word-style picker, show insertion controls immediately, and render explicit borderless OOXML without a perimeter frame.

**Architecture:** Keep table commands and OOXML writes unchanged where they are already correct. Share the existing color-picker presentation with table chrome, specialize the pointer FSM so insertion hits bypass only the reveal timer, and correct border cascade resolution so explicit cell `none` suppresses matching table borders.

**Tech Stack:** TypeScript, React, Bun test, canonical OOXML tree/layout/paint, Playwright.

## Global Constraints

- Preserve unknown OOXML and namespace bindings; do not rewrite the comprehensive fixture.
- Keep table border/fill dispatch through `useTableChromeSlot` and `runTableChromeCommand`.
- Keep deepest-first nested-table hit testing and insertion-button hide grace.
- Do not change merge/split behavior or add Vue table chrome.
- Write each regression test first and confirm the expected failure before production edits.

---

### Task 1: Match Word's borderless-table cascade

**Files:**
- Modify: `packages/core/src/layout/table-border-cascade.ts`
- Modify: `packages/core/src/layout/__tests__/table-borders.test.ts`
- Modify: `packages/core/src/layout/__tests__/comprehensive-table-fidelity.test.ts`
- Modify: `packages/core/src/output/__tests__/semantic-paint-table-borders.test.ts`

**Interfaces:**
- Consumes: `effectiveBorderSide(authored, tableSide, options)`
- Produces: explicit `authored.state === 'none'` always resolves to `{ state: 'none' }`

- [ ] **Step 1: Add fixture-level failing layout coverage**

Add a test that finds the table containing `Column A|Column B|Column C` in
`comprehensive-word-element-test.docx` and asserts every cell has no resolved
`top`, `right`, `bottom`, or `left` border:

```ts
test('§18.5 explicit cell none suppresses the table frame', () => {
  const table = findTable(layoutFixture(), 'Column A');
  for (const row of table.rows) {
    for (const cell of row.cells) {
      expect(cell.borders?.top).toBeUndefined();
      expect(cell.borders?.right).toBeUndefined();
      expect(cell.borders?.bottom).toBeUndefined();
      expect(cell.borders?.left).toBeUndefined();
    }
  }
});
```

- [ ] **Step 2: Add failing paint coverage**

Paint the comprehensive fixture, locate the table cell containing `Column A`, walk
to its table, and assert it contains no border stroke elements and no CSS border
styles other than `none`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
bun test packages/core/src/layout/__tests__/comprehensive-table-fidelity.test.ts packages/core/src/output/__tests__/semantic-paint-table-borders.test.ts
```

Expected: the §18.5 tests fail because perimeter cells resolve/paint the table's
`single` border.

- [ ] **Step 4: Correct the cascade**

Change `effectiveBorderSide` to:

```ts
export function effectiveBorderSide(
  authored: TableBorderSide,
  tableSide: TableBorderSide,
  _options: { readonly interior?: boolean } = {}
): TableBorderSide {
  if (authored.state === 'omitted') return tableSide;
  if (authored.state === 'none') return NONE;
  return authored;
}
```

Update its documentation to state that explicit cell `none` suppresses a matching
table border on interior and perimeter sides.

- [ ] **Step 5: Correct synthetic expectations**

In `table-borders.test.ts`, change the outer `none` expectations to `none` /
`undefined`, while retaining the omitted-side inheritance assertion. Update §5.3
fixture expectations for the bottom-left cell to no bottom border.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
bun test packages/core/src/layout/__tests__/table-borders.test.ts packages/core/src/layout/__tests__/comprehensive-table-fidelity.test.ts packages/core/src/output/__tests__/semantic-paint-table-borders.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/layout/table-border-cascade.ts packages/core/src/layout/__tests__/table-borders.test.ts packages/core/src/layout/__tests__/comprehensive-table-fidelity.test.ts packages/core/src/output/__tests__/semantic-paint-table-borders.test.ts
git commit -m "fix(core): render explicit borderless tables like Word"
```

---

### Task 2: Show row and column insertion controls immediately

**Files:**
- Modify: `packages/core/src/editor/surface-table-interaction.ts`
- Modify: `packages/core/src/editor/__tests__/surface-table-interaction.test.ts`
- Modify: `e2e/table-editing.interaction.spec.ts`

**Interfaces:**
- Consumes: `TableInteractionHit` and `tableInteractionHitIdentity`
- Produces: same-turn paint for `insertRow` and `insertColumn`; delayed paint remains for resize hits

- [ ] **Step 1: Add immediate row/column RED tests**

Dispatch one pointer move over each insertion band and assert the matching control
exists before awaiting any timer:

```ts
mounted.pages.dispatchEvent(pointerAtPageContent(mounted.surface, mounted.pages, 0, x, y));
expect(mounted.furniture.querySelector('.docx-table-insert-row')).not.toBeNull();
```

Add the equivalent assertion for `.docx-table-insert-column`.

- [ ] **Step 2: Add retarget and grace RED coverage**

Move between two row insertion hits in consecutive events and assert one button
updates its row identity synchronously. Keep the existing test that crosses the gap
to the button within `HOVER_HIDE_MS`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
bun test packages/core/src/editor/__tests__/surface-table-interaction.test.ts
```

Expected: immediate assertions fail because `HOVER_REVEAL_MS` defers paint.

- [ ] **Step 4: Bypass reveal delay for insertion hits**

In `onPointerMove`, after identity and hide-timer handling:

```ts
if (hit.kind === 'insertRow' || hit.kind === 'insertColumn') {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  hoverHit = hit;
  paintHover(hit, input);
  return;
}
```

Leave divider/right-edge hits on `HOVER_REVEAL_MS`; retain `HOVER_HIDE_MS`,
`overInsertControl`, identity reuse, and nested targeting.

- [ ] **Step 5: Remove insertion-only waits from e2e helpers**

Update the insertion hover helper so it waits for the control's locator rather than
sleeping 220 ms. Do not remove waits used for divider resize handles.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
bun test packages/core/src/editor/__tests__/surface-table-interaction.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/editor/surface-table-interaction.ts packages/core/src/editor/__tests__/surface-table-interaction.test.ts e2e/table-editing.interaction.spec.ts
git commit -m "fix(core): reveal table insertion controls immediately"
```

---

### Task 3: Share the full Word-style color picker with table chrome

**Files:**
- Modify: `packages/react/src/editor/toolbar/ColorSplit.tsx`
- Modify: `packages/react/src/editor/toolbar/TableControls.tsx`
- Modify: `packages/react/test/toolbar-composition.test.tsx`
- Modify: `packages/react/test/table-fix-round-5.test.tsx`

**Interfaces:**
- Produces from `ColorSplit.tsx`:

```ts
export interface ToolbarHexColorPickerBodyProps {
  readonly apply: (value: string) => void;
  readonly current: string | null;
}

export function ToolbarHexColorPickerBody(
  props: ToolbarHexColorPickerBodyProps
): ReactNode;
```

- Consumes in `TableControls.tsx`: table-specific `apply(ColorValue | null)` and shared picker presentation

- [ ] **Step 1: Add picker-shape RED tests**

Open both `table.borderColor` and `table.cellFill`. Assert each popup contains:

```ts
expect(popup.querySelector('.docx-toolbar__swatch-grid--theme')).not.toBeNull();
expect(popup.querySelectorAll('.docx-toolbar__swatch-grid:not(.docx-toolbar__swatch-grid--theme) button')).toHaveLength(10);
expect(popup.querySelector('.docx-toolbar__swatch-hex')).not.toBeNull();
```

Also assert a theme swatch and custom hex submission dispatch through table chrome,
preserving border target/style/width and applying fill through `setCellFill`.

- [ ] **Step 2: Run RED tests**

Run:

```bash
bun test packages/react/test/toolbar-composition.test.tsx packages/react/test/table-fix-round-5.test.tsx
```

Expected: table popups lack theme/custom controls and expose only four swatches.

- [ ] **Step 3: Extract the shared body**

Export a thin `ToolbarHexColorPickerBody` from `ColorSplit.tsx`. It obtains labels
with `useToolbarLabel`, obtains document theme colors using the same selector as the
existing font-color split, normalizes `current`, and renders `FontColorBody`.

Keep `FontColorBody`, `ThemeMatrix`, `Swatch`, and the standard palette internal.
Do not route table values through `commandForSlotValue`.

- [ ] **Step 4: Replace table mini-palettes**

In `buildColorSplitCompound`:

- remove `STANDARD_BORDER_SWATCHES` and `FILL_SWATCHES` as default popup bodies;
- render the existing clear-fill row for `table.cellFill`;
- render `ToolbarHexColorPickerBody` with `apply={(hex) => { setLastHex(hex); setOpen(false); apply({ kind: 'hex', value: hex }); }}`;
- derive `current` from `draft.spec.color` for border color and from `lastHex` for fill;
- preserve public `Item`, `Main`, `Trigger`, `Content`, `asChild`, focus restoration, and keyboard behavior.

- [ ] **Step 5: Run GREEN tests**

Run:

```bash
bun test packages/react/test/toolbar-composition.test.tsx packages/react/test/table-fix-round-5.test.tsx packages/core/src/editor/__tests__/table-chrome-live.test.ts packages/core/src/editor/__tests__/table-chrome-persisted.test.ts
```

Expected: all pass.

- [ ] **Step 6: Check API surface**

If the shared picker body is internal to the toolbar module, avoid exporting it from
the package root. Run:

```bash
bun run api:check
```

Expected: pass without public API drift.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/editor/toolbar/ColorSplit.tsx packages/react/src/editor/toolbar/TableControls.tsx packages/react/test/toolbar-composition.test.tsx packages/react/test/table-fix-round-5.test.tsx
git commit -m "fix(react): reuse the full color picker for tables"
```

---

### Task 4: Integrated verification and PR update

**Files:**
- Modify if needed: `.changeset/word-like-table-editing.md`
- Modify if behavior claims need correction: `docs/site/data/word-features.ts`

**Interfaces:**
- Consumes all three completed fixes
- Produces a pushed update to PR #119

- [ ] **Step 1: Run focused regression suite**

```bash
bun test packages/core/src/layout/__tests__/table-borders.test.ts packages/core/src/layout/__tests__/comprehensive-table-fidelity.test.ts packages/core/src/output/__tests__/semantic-paint-table-borders.test.ts packages/core/src/editor/__tests__/surface-table-interaction.test.ts packages/react/test/toolbar-composition.test.tsx packages/react/test/table-fix-round-5.test.tsx packages/core/src/editor/__tests__/table-chrome-live.test.ts packages/core/src/editor/__tests__/table-chrome-persisted.test.ts
```

- [ ] **Step 2: Run e2e table story**

```bash
bunx playwright test e2e/table-editing.interaction.spec.ts
```

- [ ] **Step 3: Run repository gates**

```bash
bun run format
bun run typecheck
bun run api:check
bun run i18n:validate
openspec validate typed-ooxml-paragraph-editor --strict
bun test
bun run check:parity
```

Compare the final two commands with the recorded non-clean base: 33 tracked-review
tests and `check:public-docs-surface` are known baseline failures.

- [ ] **Step 4: Push PR branch**

```bash
git push origin feat/v2-table-editing
```
