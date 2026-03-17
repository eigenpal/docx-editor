## Context

The editor currently has no right-click handling. PagedEditor.tsx explicitly ignores non-left-click events (`if (e.button !== 0) return`). A `TextContextMenu.tsx` component exists (685 lines) with basic clipboard operations, but it's never wired into the editor. The codebase has mature dropdown infrastructure (`MenuDropdown`, `useFixedDropdown`, `TableOptionsDropdown`) and 100+ editor commands already available via ProseMirror extensions.

The click-to-position pipeline (`getPositionFromMouse`) already maps pixel coordinates to PM document positions, which is the foundation for determining right-click context.

## Goals / Non-Goals

**Goals:**

- Context-aware right-click menu that shows relevant items based on what was clicked (text, table, image, link)
- Keyboard-navigable (arrow keys, Enter to activate, Escape to close)
- Viewport-aware positioning (menu stays within visible area)
- Extensible architecture — easy to add new context types (e.g., shapes, footnotes) later
- Consistent look and feel with existing toolbar dropdowns

**Non-Goals:**

- Nested submenus (e.g., "Format options >" submenu like Google Docs) — keep flat for v1
- Custom context menu items via consumer API — defer to follow-up
- Touch/long-press support — desktop-first for now
- Replacing the toolbar or TableOptionsDropdown — context menu complements them

## Decisions

### 1. Single ContextMenu component with pluggable item providers

**Decision:** Create one `ContextMenu` component that receives a list of menu items. A `resolveContextMenuItems()` function inspects the PM state at the click position and assembles the item list from registered providers.

**Why:** This is simpler than multiple specialized menu components (TableContextMenu, ImageContextMenu, etc.) and matches how Google Docs works — one menu, different items. Adding a new context (e.g., shapes) means adding one provider function, not a new component.

**Alternative considered:** Separate components per context type — rejected because contexts overlap (e.g., right-clicking a link inside a table should show both link and table items).

### 2. Context resolution via PM doc inspection at click position

**Decision:** Use `getPositionFromMouse()` to get the PM position, then walk the PM document structure to detect:

1. Whether text is selected (check `state.selection.empty`)
2. Whether position is inside a table cell (walk up `$pos.path` for table_cell node)
3. Whether position is on an image node (check node at position)
4. Whether position has a hyperlink mark (check marks at position)

**Why:** All this information is already in the PM document — no need for DOM inspection or separate hit-testing. The PM `ResolvedPos` API provides parent node traversal.

**Alternative considered:** DOM-based detection (checking CSS classes on the clicked element) — rejected because it's fragile and doesn't give us PM-level context needed to dispatch commands.

### 3. Replace TextContextMenu.tsx with new generic ContextMenu

**Decision:** Delete `TextContextMenu.tsx` and its hook. Build a new `ContextMenu.tsx` that handles all contexts. Reuse positioning/keyboard patterns from the existing component but with the new provider architecture.

**Why:** TextContextMenu is 685 lines of tightly coupled code for just clipboard operations. The new component will be leaner (menu rendering only) with context resolution extracted to a utility.

### 4. Menu items as data, not components

**Decision:** Define menu items as plain objects: `{ id, label, icon?: string, shortcut?, disabled?, separator?, action }`. The `icon` field is a Material Symbol name string (e.g., `"content_cut"`, `"content_copy"`). The ContextMenu component renders them uniformly using `<MaterialSymbol name={item.icon} />`.

**Why:** Makes it trivial to compose items from multiple providers, filter disabled items, and test without rendering. Matches the pattern used in MenuDropdown.tsx.

### 4b. Icons from Material Symbols — manually imported as inline SVGs

**Decision:** All context menu icons MUST be imported from Google Material Symbols and added as inline SVG React components in `packages/react/src/components/ui/Icons.tsx`, then registered in the `iconMap` for use via `<MaterialSymbol name="..." />`. No icon fonts, no external CDN, no runtime fetching.

**Why:** This is the established pattern across the entire codebase (Toolbar, TableOptionsDropdown, etc.). Icons are sourced from https://fonts.google.com/icons, converted to `<path d="...">` inside a `SvgIcon` wrapper component, and exported from `Icons.tsx`. Each new icon needed for the context menu (e.g., `content_cut`, `content_copy`, `content_paste`, `content_paste_off`, `delete`, `link`, `link_off`, `add_comment`, `format_clear`, `open_in_new`, `image`, `alt_text`) must be manually added to `Icons.tsx` if not already present.

**Alternative considered:** Using an icon font or dynamic loading — rejected because the codebase is client-side only with no external dependencies, and all existing icons follow the inline SVG pattern.

### 5. Event handling: preventDefault + set selection before showing menu

**Decision:** On `contextmenu` event:

1. `preventDefault()` to suppress browser menu
2. Map click position to PM position via `getPositionFromMouse()`
3. If click is outside current selection, move cursor to click position (matching Google Docs behavior)
4. If click is inside current selection, keep selection (so cut/copy operate on selected text)
5. Resolve context and show menu

**Why:** Google Docs moves the cursor on right-click outside selection, preserves selection on right-click inside. This is the expected behavior.

### 6. Clipboard operations via document.execCommand / Clipboard API

**Decision:** Cut/Copy/Paste in the context menu will focus the hidden ProseMirror and trigger `document.execCommand('cut'|'copy'|'paste')` or use the Clipboard API where available. This lets PM's existing clipboard handling do the work.

**Why:** ProseMirror already handles clipboard serialization/deserialization with full formatting. Reimplementing clipboard logic would be error-prone and duplicate work.

**Caveat:** `document.execCommand('paste')` is blocked by most browsers for security. The Paste item may need to show "Use Cmd+V" hint, or use `navigator.clipboard.readText()` with permission. This matches Google Docs behavior (their Paste menu item also shows the shortcut hint).

### 7. File structure

```
packages/react/src/components/
├── ContextMenu.tsx              — Menu rendering component (position, keyboard nav, item rendering)
├── contextMenuItems.ts          — Item provider functions per context type
└── useContextMenu.ts            — Hook: state management, open/close, event binding

packages/core/src/prosemirror/
└── utils/contextResolver.ts     — Resolves PM position → ContextInfo (isInTable, isOnImage, etc.)
```

## Risks / Trade-offs

**[Risk] Clipboard paste blocked by browsers** → Mitigation: Show keyboard shortcut hint next to Paste item (Cmd+V / Ctrl+V). Use Clipboard API with `navigator.clipboard.read()` where permissions allow. This is the same approach Google Docs uses.

**[Risk] Context menu interferes with ProseMirror focus** → Mitigation: Apply `onMouseDown` with `preventDefault` + `stopPropagation` on all menu elements, matching the pattern used in every existing dropdown (TableOptionsDropdown, ColorPicker, etc.).

**[Risk] Menu positioning edge cases with zoom** → Mitigation: Use `position: fixed` with viewport boundary checks, same as `useFixedDropdown`. Account for the editor's zoom level when computing click coordinates (already handled by `getPositionFromMouse`).

**[Trade-off] No nested submenus in v1** → Keeps implementation simple. If users need "Format options >" submenu, it can be added later using the existing `MenuDropdown` submenu support.

**[Trade-off] Deleting TextContextMenu.tsx** → Loses some edge-case handling, but the component was never integrated anyway. Key patterns (keyboard nav, viewport checks) will be reimplemented in the new component.
