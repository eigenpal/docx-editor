# Tasks: Format Menu + Text Formatting

## Task 1: Track smallCaps, allCaps, characterSpacing in selectionTracker

**File:** `packages/core/src/prosemirror/plugins/selectionTracker.ts`

1. Verify `smallCaps` and `allCaps` booleans are extracted from active marks at cursor
2. Verify `characterSpacing` (the `spacing` attr from `charSpacing` mark) is extracted
3. If any are missing, add extraction in the text formatting section alongside bold/italic/etc.
4. Run typecheck to confirm types align

**Estimated effort:** Small (5-15 lines)

## Task 2: Add strikethrough button to FormattingBar

**File:** `packages/react/src/components/FormattingBar.tsx`

1. Verify `strikethrough_s` exists in `iconMap` in `packages/react/src/components/ui/Icons.tsx` — if missing, download SVG path from [Material Symbols](https://fonts.google.com/icons?selected=Material+Symbols+Outlined:strikethrough_s) and add as a new `IconStrikethrough` component + register in `iconMap`
2. Add `<ToolbarButton>` for strikethrough after the underline button
3. Icon: `strikethrough_s` via `<MaterialSymbol name="strikethrough_s" size={18} />`
4. Tooltip: `"Strikethrough (Ctrl+Shift+X)"`
5. Active state: `textFormatting.strike`
6. onClick: `onFormat('toggleStrike')`

**Note:** All icons are inline SVG components in `Icons.tsx`, NOT loaded from Google Fonts. Any new icon must be manually added there (see spec.md Icons section).

**Estimated effort:** Small (5-15 lines depending on whether icon exists)

## Task 3: Restructure Format menu with text formatting options

**File:** `packages/react/src/components/Toolbar.tsx`

1. Replace current Format menu items with expanded structure:
   - Text section header
   - Bold, Italic, Underline, Strikethrough with keyboard shortcuts and checked state
   - Separator
   - Small Caps, All Caps with checked state
   - Separator
   - Character spacing submenu (Normal, Expanded +1pt/+2pt, Condensed -1pt/-2pt)
   - Separator
   - Existing LTR/RTL items
2. Read textFormatting from selection context for checked states
3. Wire menu item clicks to formatting actions

**Estimated effort:** Medium (40-60 lines)

## Task 4: Support checked items and submenus in MenuDropdown

**File:** `packages/react/src/components/ui/MenuDropdown.tsx`

1. Check if `checked` prop on items is already supported — if yes, skip
2. If not, add checkmark rendering (✓ prefix or check icon) for items with `checked: true`
3. Check if nested `submenu` arrays are supported — if yes, skip
4. If not, add hover-triggered submenu flyout rendering

**Estimated effort:** Small-Medium (0-30 lines depending on existing support)

## Task 5: Wire all new formatting actions in toolbarUtils

**File:** `packages/react/src/components/toolbarUtils.ts`

1. Add `toggleStrike` → `manager.commands.toggleStrike()`
2. Add `toggleSmallCaps` → `manager.commands.toggleSmallCaps()`
3. Add `toggleAllCaps` → `manager.commands.toggleAllCaps()`
4. Add `setCharSpacing` → `manager.commands.setCharacterSpacing({ spacing: value })`
5. If `applyFormattingAction` doesn't accept a `value` param, extend its signature

**Estimated effort:** Small (10-20 lines)

## Task Dependencies

```
Task 1 (selection tracking) ──┐
Task 4 (menu component)   ────┼──→ Task 3 (Format menu) ──→ Done
Task 5 (action wiring)    ────┘
Task 2 (toolbar button)   ──→ Task 5 ──→ Done
```

Tasks 1, 2, 4 can run in parallel. Task 3 depends on 1, 4, 5. Task 5 is independent.

## Verification

```bash
bun run typecheck && npx playwright test tests/formatting.spec.ts tests/toolbar-state.spec.ts --timeout=30000 --workers=4
```
