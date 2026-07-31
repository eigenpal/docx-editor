# Toolbar & Selection Interaction Fixes

## Problem

Several UX issues around how the toolbar interacts with text selection:

1. **Selection disappears when dropdown opens** — selecting text then opening a toolbar dropdown (font picker, etc.) causes the selection highlight to disappear. The selected range should remain visually highlighted while the dropdown is open.

2. **Dropdowns don't close on outside click** — toolbar dropdowns (font, format, table options) stay open when clicking on the editor body. They should close when the user clicks anywhere outside the dropdown.

3. **Right-click resets selection (Firefox)** — in Firefox, right-clicking on selected text resets the selection immediately, preventing context menu operations on the selected text.

4. **Default font/size not shown in toolbar** — when cursor is in text with default (inherited) font/size, the toolbar dropdowns don't highlight the active font or size. Only manually-applied fonts show correctly.

5. **Table options tooltip missing** — the table options toolbar icon doesn't show a tooltip on hover.

## Scope

- Preserve selection highlight when toolbar dropdowns are open
- Close dropdowns on outside click (including editor body clicks)
- Fix Firefox right-click selection behavior
- Resolve and display inherited/default font in toolbar
- Add missing tooltip to table options icon

## Out of scope

- Custom context menus
- Toolbar layout/responsive behavior
