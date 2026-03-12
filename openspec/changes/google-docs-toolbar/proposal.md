## Why

The current toolbar mixes menu items (File, Format, Insert) and formatting icons in a single row, while demo apps duplicate UI concerns (doc name, file operations) in a separate header outside the editor. This makes the editor look like a widget rather than a full document editor. A Google Docs-style 2-level toolbar with composable slots would give users a professional, familiar UX out of the box while letting them customize every section (logo, doc name, menus, action buttons).

## What Changes

- **New 2-level toolbar layout**: Title bar (top) with logo, document name, menus, and right-side actions; formatting bar (bottom) with icon-based tools
- **Compound component API**: `EditorToolbar` with composable sub-components (`TitleBar`, `Logo`, `DocumentName`, `MenuBar`, `TitleBarRight`, `FormattingBar`) following Radix UI patterns
- **Props-based shortcut on DocxEditor**: `toolbarLayout="google-docs"` with `renderLogo`, `documentName`, `onDocumentNameChange`, `renderTitleBarRight` for the common case
- **Extract menus from formatting bar**: File, Format, Insert menus move to the title bar's menu row
- **Extract formatting bar**: Current toolbar minus menus becomes `FormattingBar`
- **Backward compatible**: `toolbarLayout="classic"` (default) preserves current single-row behavior; existing `showToolbar`, `toolbarExtra` props still work
- **Update demo apps**: Vite and NextJS examples use new 2-level layout, removing their custom headers

## Capabilities

### New Capabilities

- `composable-toolbar`: Compound component system for 2-level Google Docs-style toolbar with customizable logo, document name, menu bar, right-side actions, and formatting bar slots

### Modified Capabilities

## Impact

- **Components**: `Toolbar.tsx` refactored into sub-components; `DocxEditor.tsx` gains new props and layout mode
- **New files**: `EditorToolbar.tsx`, `TitleBar.tsx`, `FormattingBar.tsx`, `EditorToolbarContext.tsx`
- **Exports**: New public API surface (`EditorToolbar`, sub-components, new DocxEditor props)
- **Examples**: Both Vite and NextJS demos updated to use new layout
- **Breaking**: None — default behavior unchanged, new layout is opt-in
- **Dependencies**: No new external deps
