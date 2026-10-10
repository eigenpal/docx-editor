## Context

The editor's toolbar (`Toolbar.tsx`, ~1089 lines) renders everything in a single row: menus (File, Format, Insert) + formatting icons + context-specific tools (table, image) + custom children. Meanwhile, demo apps (Vite, NextJS) build their own separate header outside `DocxEditor` with doc name, viewing/editing toggle, Open/New/Save buttons. This creates a disconnected, widget-like appearance instead of a cohesive document editor experience.

Google Docs uses a 2-level toolbar pattern:

- **Row 1 (Title Bar)**: Logo + editable document name + menu bar (File, Edit, View, Insert, Format, Tools, Extensions, Help) + right-side actions (Share, etc.)
- **Row 2 (Formatting Bar)**: Icon-based formatting tools (undo/redo, zoom, styles, fonts, bold/italic, colors, alignment, lists, etc.)

Current `DocxEditor` props for toolbar customization: `showToolbar`, `toolbarExtra` (ReactNode), `showZoomControl`, `showPrintButton`, `showRuler`, `readOnly`. The `Toolbar` component accepts 30+ props and a `children` slot appended at the end.

## Goals / Non-Goals

**Goals:**

- Create a 2-level Google Docs-style toolbar with a title bar and formatting bar
- Make all sections composable: logo, document name, menus, right-side actions, formatting tools
- Provide both compound component API (full control) and simple props API (quick setup)
- Maintain 100% backward compatibility — existing `toolbarLayout="classic"` (default) preserves current behavior
- Move menus (File, Format, Insert) from the formatting bar to the title bar
- Enable demo apps to consolidate their custom headers into the toolbar system

**Non-Goals:**

- Implementing Edit/View/Tools/Extensions/Help menus (only move existing File/Format/Insert)
- Custom menu item API for adding user-defined menus (future work)
- Responsive/mobile-specific title bar layout (keep simple collapse behavior)
- Changing any formatting logic, toolbar state management, or keyboard shortcuts
- Themeable/skinnable toolbar (stays white/slate like current)

## Decisions

### 1. Compound Component Pattern with Context

**Decision**: Use React Context + compound components (like Radix UI / Headless UI patterns) rather than render props or HOCs.

**Rationale**: Compound components let users compose the toolbar declaratively while sharing state through context. This is the standard pattern for composable React UI libraries.

**Alternative considered**: Render props (`renderTitleBar`, `renderFormattingBar`) — more flexible but harder to read and type, and doesn't compose as cleanly.

**Implementation**:

```tsx
// EditorToolbarContext provides shared state (formatting, handlers, etc.)
<EditorToolbar {...toolbarProps}>
  <EditorToolbar.TitleBar>
    <EditorToolbar.Logo>
      <MyIcon />
    </EditorToolbar.Logo>
    <EditorToolbar.DocumentName value={name} onChange={setName} />
    <EditorToolbar.MenuBar />
    <EditorToolbar.TitleBarRight>
      <button>Save</button>
    </EditorToolbar.TitleBarRight>
  </EditorToolbar.TitleBar>
  <EditorToolbar.FormattingBar />
</EditorToolbar>
```

### 2. Extract FormattingBar from Toolbar — Don't Duplicate

**Decision**: Extract the icon toolbar (everything after menus in current `Toolbar.tsx`) into a `FormattingBar` component. The existing `Toolbar` component becomes a thin wrapper that renders either classic (single row with menus + formatting) or the new layout.

**Rationale**: Avoids code duplication — the formatting bar logic (handlers, keyboard shortcuts, state) stays in one place. The "classic" layout just renders `FormattingBar` with menus prepended.

**Alternative considered**: Keeping `Toolbar.tsx` as-is and building `EditorToolbar` from scratch — would duplicate 500+ lines of formatting logic.

### 3. Props-Based Shortcut on DocxEditor

**Decision**: Add new props to `DocxEditor` for the common Google Docs layout:

```tsx
toolbarLayout?: 'classic' | 'google-docs'  // default: 'classic'
renderLogo?: () => ReactNode
documentName?: string
onDocumentNameChange?: (name: string) => void
renderTitleBarRight?: () => ReactNode
```

**Rationale**: Most users want the Google Docs layout without learning the compound component API. These props provide a zero-configuration upgrade path.

**Alternative considered**: Forcing everyone to use compound components — too high a migration bar for existing users.

### 4. EditorToolbar Shares ToolbarProps via Context

**Decision**: `EditorToolbar` accepts the same props as current `Toolbar` (formatting state, handlers) and provides them via `EditorToolbarContext`. Sub-components like `MenuBar` and `FormattingBar` consume from context.

**Rationale**: Avoids prop drilling through 3+ levels. The context pattern is idiomatic for compound components.

### 5. Title Bar MenuBar Auto-Populates from Context

**Decision**: `EditorToolbar.MenuBar` renders File/Format/Insert menus using the same handler functions from context. It doesn't accept menu item props — it uses the same items currently in `Toolbar.tsx`.

**Rationale**: Keeps the menu system simple. Custom menus are a non-goal. Users who want additional menus can add them as siblings to `MenuBar` in the title bar.

### 6. New File Structure

```
src/components/
  Toolbar.tsx              — MODIFIED: becomes thin wrapper, imports FormattingBar
  EditorToolbar.tsx        — NEW: compound component + context + sub-components
  FormattingBar.tsx        — NEW: extracted icon toolbar (from Toolbar.tsx lines 804-1073)
  TitleBar.tsx             — NEW: title bar with logo, doc name, menus, right slot
  DocxEditor.tsx           — MODIFIED: add toolbarLayout + new props
```

All new files stay in `src/components/` alongside `Toolbar.tsx` — no new directories.

### 7. Backward Compatibility Strategy

- `toolbarLayout` defaults to `'classic'`, preserving current single-row behavior
- Existing `Toolbar` component is still exported with the same API
- `toolbarExtra` still works (appended to FormattingBar in both layouts)
- `ToolbarButton`, `ToolbarGroup`, `ToolbarSeparator` still exported from `Toolbar.tsx`
- No breaking changes to `DocxEditorProps`

## Risks / Trade-offs

- **[Risk] Context overhead** → Minimal: context only holds references to existing callbacks, not frequently-changing data. Selection formatting updates are already handled via props.

- **[Risk] Large refactor surface** → Mitigated by extracting FormattingBar without changing its internals. The move is mechanical (cut/paste + context consumption).

- **[Risk] Two toolbar APIs to maintain** → Acceptable: the props-based API on DocxEditor is a thin wrapper over the compound component API. One implementation, two access points.

- **[Trade-off] No custom menus** → Keeps scope manageable. Users can add custom menu components in the title bar via `TitleBarRight` or as direct children.

- **[Trade-off] Title bar not responsive** → Simple CSS overflow behavior (hide right slot items on narrow screens). Full responsive mobile title bar is deferred.
