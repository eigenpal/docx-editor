# Tasks: Paragraph Formatting Controls

## Task 1: Add spaceBefore/spaceAfter to selectionTracker

**File:** `packages/core/src/prosemirror/plugins/selectionTracker.ts`

1. In paragraph formatting extraction block, read `spaceBefore` and `spaceAfter` from resolved paragraph attrs
2. Default to 0 if undefined
3. Include in emitted `paragraphFormatting` object

**Estimated effort:** Small (2-4 lines)

## Task 2: Extend LineSpacingPicker with paragraph spacing

**File:** `packages/react/src/components/ui/LineSpacingPicker.tsx`

1. Add `spaceBefore`, `spaceAfter`, `onSpaceBeforeChange`, `onSpaceAfterChange` props
2. Define `DEFAULT_PARAGRAPH_SPACE_TWIPS = 160` (8pt)
3. Below line spacing presets, under the "Paragraph spacing" section header:
   - Render "Add/Remove space before paragraph" toggle item
   - Render "Add/Remove space after paragraph" toggle item
4. Label logic: show "Add" when value is 0/undefined, "Remove" when > 0
5. Click: set to 0 (remove) or DEFAULT_PARAGRAPH_SPACE_TWIPS (add)

**Estimated effort:** Medium (25-35 lines)

## Task 3: Wire spacing props in FormattingBar

**File:** `packages/react/src/components/FormattingBar.tsx`

1. Read `spaceBefore`/`spaceAfter` from `paragraphFormatting` selection context
2. Pass as props to `LineSpacingPicker`
3. Wire `onSpaceBeforeChange` → dispatch `setSpaceBefore` command
4. Wire `onSpaceAfterChange` → dispatch `setSpaceAfter` command

**Estimated effort:** Small (8-12 lines)

## Task 4: Fix indent/outdent for non-list paragraphs

**File:** `packages/react/src/components/ui/ListButtons.tsx`

1. Read `inList` and `indentLeft` from selection context
2. In indent handler: if `inList`, call `increaseListLevel`; else call `increaseIndent`
3. In outdent handler: if `inList`, call `decreaseListLevel`; else call `decreaseIndent`
4. Disable outdent button when not in list and `indentLeft <= 0`

**Estimated effort:** Small (10-15 lines)

## Task 5: Wire new actions in toolbarUtils

**File:** `packages/react/src/components/toolbarUtils.ts`

1. Add `increaseIndent` → `manager.commands.increaseIndent()`
2. Add `decreaseIndent` → `manager.commands.decreaseIndent()`
3. Add `setSpaceBefore` → `manager.commands.setSpaceBefore(value)`
4. Add `setSpaceAfter` → `manager.commands.setSpaceAfter(value)`

**Estimated effort:** Small (8-12 lines)

## Task Dependencies

```
Task 1 (selectionTracker) ──→ Task 3 (FormattingBar wiring) ──→ Done
Task 2 (LineSpacingPicker) ──→ Task 3
Task 4 (indent fix) ──→ Task 5 (action wiring) ──→ Done
```

Tasks 1, 2, 4 can run in parallel.

## Verification

```bash
bun run typecheck && npx playwright test tests/line-spacing.spec.ts tests/lists.spec.ts tests/paragraph-styles.spec.ts tests/alignment.spec.ts --timeout=30000 --workers=4
```
