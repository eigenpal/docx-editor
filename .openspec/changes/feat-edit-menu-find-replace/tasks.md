# Tasks: Edit Menu + Find & Replace + Spell Check

## Task 1: Add Edit menu to Toolbar

**File:** `packages/react/src/components/Toolbar.tsx`

1. Add `<MenuDropdown label="Edit">` between File and Format menus
2. Menu items: Undo (⌘Z), Redo (⌘Y), separator, Find (⌘F), Find and Replace (⌘H), separator, Select All (⌘A), separator, Spelling (toggle with checkmark)
3. Wire actions: undo/redo dispatch commands, find/replace open dialog, selectAll selects doc, spelling toggles spellcheck
4. Show disabled state on Undo when no history, Redo when nothing to redo (if trackable)

**Estimated effort:** Medium (30-40 lines)

## Task 2: Wire Find & Replace dialog to Edit menu

**File:** `packages/react/src/components/DocxEditor.tsx` (or wherever FindReplaceDialog is managed)

1. Locate how Ctrl+F / Ctrl+H currently open the dialog
2. Extract `openFind()` and `openFindReplace()` as callbacks
3. Pass these callbacks down to `Toolbar` as `onOpenFind` / `onOpenFindReplace` props
4. Ensure clicking "Find" opens in find-only mode, "Find and Replace" opens with replace field visible

**Estimated effort:** Small-Medium (10-20 lines)

## Task 3: Add spell check toggle

**File:** `packages/react/src/components/DocxEditor.tsx`

1. Add `spellCheckEnabled` state (default: `true`)
2. Pass to Toolbar as prop (for checkmark state)
3. Pass `onToggleSpellCheck` callback to Toolbar

**File:** `packages/react/src/components/paged-editor/HiddenProseMirror.tsx` 4. Accept `spellCheckEnabled` prop 5. Set `spellcheck` attribute on ProseMirror EditorView via `attributes` config option 6. Update attribute when prop changes (via `EditorView.setProps` or `useEffect`)

**Estimated effort:** Small (10-15 lines across 2 files)

## Task 4: Add selectAll action

**File:** `packages/react/src/components/toolbarUtils.ts`

1. Add `selectAll` case that selects entire document content
2. Use PM's `selectAll` from `prosemirror-commands` or create TextSelection spanning full doc

**Estimated effort:** Small (5-8 lines)

## Task Dependencies

```
Task 2 (wire F&R callbacks) ──┐
Task 3 (spell check state)  ──┼──→ Task 1 (Edit menu) ──→ Done
Task 4 (selectAll action)   ──┘
```

Tasks 2, 3, 4 can run in parallel. Task 1 depends on all three for the full wiring.

## Verification

```bash
bun run typecheck && npx playwright test tests/formatting.spec.ts tests/text-editing.spec.ts --timeout=30000 --workers=4
```

### Manual smoke test

1. Open editor → verify Edit menu appears between File and Format
2. Edit → Find → verify Find dialog opens
3. Edit → Find and Replace → verify Replace field shows
4. Edit → Spelling → verify checkmark toggles, red squiggles appear/disappear
5. Edit → Select All → verify all text selected
6. Edit → Undo/Redo → verify works same as toolbar buttons
