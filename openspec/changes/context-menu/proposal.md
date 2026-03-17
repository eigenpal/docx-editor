## Why

The editor has no right-click context menu — right-clicking shows the browser's default menu, which breaks the professional editing experience. Google Docs, Word Online, and every serious document editor provides context-aware right-click menus that surface relevant actions based on where the user clicks (text, table, image, link). This is a core UX expectation for a WYSIWYG editor. The building blocks already exist (TextContextMenu component, 100+ commands, TableOptionsDropdown) but aren't wired together.

## What Changes

- Intercept `contextmenu` event on the pages container in PagedEditor, suppressing the browser default menu
- Add a **context resolver** that inspects the ProseMirror document at the click position to determine what was right-clicked (plain text, selected text, table cell, image, hyperlink, or combinations)
- Build a **generic context menu component** that composes menu items dynamically based on the resolved context
- Base items always shown: Cut, Copy, Paste, Paste without formatting, Delete
- Text selection items: Comment, Insert link, Clear formatting
- Table context items: Insert row above/below, Insert column left/right, Delete row/column/table, Merge/split cells
- Image context items: Image properties, Wrap options, Alt text
- Hyperlink context items: Edit link, Remove link, Open link
- Keyboard navigation (arrow keys, Enter, Escape) and viewport-aware positioning
- Replace/retire the existing unused `TextContextMenu.tsx` component

## Capabilities

### New Capabilities

- `context-menu-core`: Generic context menu infrastructure — event interception, context resolution from PM doc position, menu rendering with keyboard navigation and viewport-aware positioning
- `context-menu-text`: Text context menu items — clipboard operations (cut/copy/paste/paste plain/delete), comment, insert link, clear formatting
- `context-menu-table`: Table context menu items — insert/delete rows and columns, merge/split cells, table properties
- `context-menu-image`: Image context menu items — image properties, wrap options, alt text
- `context-menu-link`: Hyperlink context menu items — edit link, remove link, open link in new tab

### Modified Capabilities

_None — no existing specs to modify._

## Impact

- **PagedEditor.tsx** — Add `onContextMenu` handler, context resolution logic, menu state management
- **TextContextMenu.tsx** — Replace with new generic context menu component (or heavily refactor)
- **New files** — Context resolver utility, context menu component, menu item definitions per context type
- **Existing commands** — No changes needed; table/link/comment/formatting commands are already available via extensions
- **Dependencies** — No new external dependencies; uses existing React + ProseMirror APIs
- **API surface** — Optional `onContextMenu` callback prop on DocxEditor for consumers to customize/extend menu items
