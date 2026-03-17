## 1. Context Resolution Infrastructure

- [ ] 1.1 Create `packages/core/src/prosemirror/utils/contextResolver.ts` — implement `resolveContext(state, pos)` that inspects PM doc at a resolved position and returns `ContextInfo` object (`isTextSelected`, `isInTable`, `isOnImage`, `isOnHyperlink`, plus metadata like table row/col count, link href, image node ref)
- [ ] 1.2 Add unit tests for context resolver covering all scenarios: plain text, inside table, on image, on hyperlink, overlapping contexts (link in table), selected text vs cursor-only

## 2. Icons

- [ ] 2.1 Audit `packages/react/src/components/ui/Icons.tsx` and `iconMap` for which context menu icons already exist vs need to be added. Required icons: `content_cut`, `content_copy`, `content_paste`, `content_paste_off` (paste without formatting), `delete`, `add_comment`, `insert_link`, `link_off`, `open_in_new`, `format_clear`, `image`, `alt_text`, `wrap_text`, `table_rows`, `add_row` (or similar row/column insert icons), `delete_row`, `delete_column`, `cell_merge`, `split_scene` (or similar split icon)
- [ ] 2.2 For each missing icon, download the SVG path from https://fonts.google.com/icons (Material Symbols, weight 400, grade 0, optical size 24), create an inline React component in `Icons.tsx` using the `SvgIcon` wrapper, and register it in `iconMap`

## 3. Context Menu Component

- [ ] 3.1 Create `packages/react/src/components/useContextMenu.ts` hook — manages open/close state, click position, resolved context. Handles outside click, scroll, and Escape to close. Handles re-opening on subsequent right-clicks.
- [ ] 3.2 Create `packages/react/src/components/ContextMenu.tsx` — renders menu items as a `position: fixed` overlay. Supports keyboard navigation (ArrowUp/Down, Enter, Escape). Viewport-aware positioning (flips when near edges). Items rendered from `{ id, label, icon?: string, shortcut?, disabled?, separator?, action }` data. Icons rendered via `<MaterialSymbol name={item.icon} />`. All interactive elements use `onMouseDown` with `preventDefault` + `stopPropagation` to preserve PM focus.
- [ ] 3.3 Style the context menu to match existing dropdown aesthetics (MenuDropdown/TableOptionsDropdown) — white background, subtle shadow, rounded corners, hover states, disabled styling, separator lines, shortcut text right-aligned, icon left-aligned

## 4. Menu Item Providers

- [ ] 4.1 Create `packages/react/src/components/contextMenuItems.ts` — implement `getBaseItems(context)` returning clipboard items (Cut, Copy, Paste, Paste without formatting, Delete) with icon names (`content_cut`, `content_copy`, `content_paste`, `content_paste_off`, `delete`), correct disabled states based on selection, and platform-aware shortcut labels (Cmd vs Ctrl)
- [ ] 4.2 Implement `getTextItems(context)` — returns Comment (`add_comment`), Insert link (`insert_link`), Clear formatting (`format_clear`) items. Only included when text is selected.
- [ ] 4.3 Implement `getTableItems(context)` — returns Insert row above/below, Insert column left/right, Delete row/column/table, Merge cells, Split cell items with appropriate icons. Only included when `isInTable`. Merge/split conditionally shown based on multi-cell selection and merged cell state.
- [ ] 4.4 Implement `getImageItems(context)` — returns Image properties (`image`), Wrap options (`wrap_text`), Alt text (`alt_text`) items. Only included when `isOnImage`.
- [ ] 4.5 Implement `getLinkItems(context)` — returns Edit link (`insert_link`), Remove link (`link_off`), Open link (`open_in_new`) items. Only included when `isOnHyperlink`.
- [ ] 4.6 Implement `composeMenuItems(context)` — combines all providers with separator dividers between groups, filters empty groups

## 5. PagedEditor Integration

- [ ] 5.1 Add `onContextMenu` handler to the pages container in `PagedEditor.tsx` — calls `preventDefault`, maps click to PM position via `getPositionFromMouse`, updates selection (move cursor if outside selection, preserve if inside), resolves context, opens menu
- [ ] 5.2 Wire menu item actions to existing editor commands — clipboard via `document.execCommand` or Clipboard API on the hidden PM, table operations via `TableExtension` commands, link operations via `HyperlinkExtension` commands, comment via comment flow, formatting via `clearFormatting` command
- [ ] 5.3 Delete or replace `TextContextMenu.tsx` and `useTextContextMenu` hook with the new generic implementation

## 6. Testing & Polish

- [ ] 6.1 Add Playwright E2E tests for context menu: right-click shows menu, clicking items executes actions, keyboard navigation works, menu closes on outside click/Escape, menu positioned correctly near viewport edges
- [ ] 6.2 Add Playwright tests for table context: right-click in table shows table items, insert/delete row/column operations work from context menu
- [ ] 6.3 Verify context menu works correctly with zoom levels and in header/footer editing mode
- [ ] 6.4 Run typecheck + full targeted test suite to confirm no regressions
