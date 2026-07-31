## 1. Create EditorToolbar Context and Types

- [x] 1.1 Create `src/components/EditorToolbarContext.tsx` with `EditorToolbarContext` React context that holds all `ToolbarProps` fields (formatting state, handlers, visibility flags, etc.) and a `useEditorToolbar()` hook that consumes it
- [x] 1.2 Define `EditorToolbarProps` type extending `ToolbarProps` — same props as current Toolbar, used as the context provider value

## 2. Extract FormattingBar from Toolbar

- [x] 2.1 Create `src/components/FormattingBar.tsx` by extracting the icon toolbar rendering from `Toolbar.tsx` (undo/redo through clear formatting + children slot, lines 804-1073) — consume all state from `EditorToolbarContext` instead of props
- [x] 2.2 Move the formatting-related callbacks (`handleFormat`, `handleUndo`, `handleRedo`, `handleFontFamilyChange`, etc.) into `FormattingBar` — they read handlers from context
- [x] 2.3 Move the keyboard shortcuts effect and focus management (mousedown/mouseup handlers) into `FormattingBar`
- [x] 2.4 Verify `FormattingBar` renders identically to current toolbar minus menus by running `bun run typecheck`

## 3. Create TitleBar Sub-Components

- [x] 3.1 Create `src/components/TitleBar.tsx` with `TitleBar` component — renders a two-row flex layout: row 1 for logo + doc name + right actions, row 2 for menu bar. Detects which rows have content and only renders non-empty rows
- [x] 3.2 Implement `Logo` sub-component — simple wrapper that renders children left-aligned in row 1
- [x] 3.3 Implement `DocumentName` sub-component — controlled text input with `value`, `onChange`, `placeholder` props, styled as a borderless editable field (like Google Docs doc name)
- [x] 3.4 Implement `MenuBar` sub-component — renders File/Format/Insert `MenuDropdown`s using handlers from `EditorToolbarContext` (same menu items currently in Toolbar.tsx lines 721-802)
- [x] 3.5 Implement `TitleBarRight` sub-component — renders children right-aligned in row 1 with `ml-auto`
- [x] 3.6 Add mousedown `preventDefault` on TitleBar to preserve editor focus (same pattern as current toolbar)

## 4. Create EditorToolbar Compound Component

- [x] 4.1 Create `src/components/EditorToolbar.tsx` — wraps children in `EditorToolbarContext.Provider`, renders a flex-col container. Attach sub-components as static properties: `EditorToolbar.TitleBar`, `EditorToolbar.Logo`, `EditorToolbar.DocumentName`, `EditorToolbar.MenuBar`, `EditorToolbar.TitleBarRight`, `EditorToolbar.FormattingBar`
- [x] 4.2 Verify compound component renders correctly with all sub-components by running `bun run typecheck`

## 5. Refactor Toolbar.tsx to Use FormattingBar

- [x] 5.1 Modify `Toolbar.tsx` to import and use `FormattingBar` internally — for classic layout, render menus (File/Format/Insert) followed by `FormattingBar` in a single row, preserving identical output
- [x] 5.2 Keep all existing exports from `Toolbar.tsx` unchanged (`Toolbar`, `ToolbarButton`, `ToolbarGroup`, `ToolbarSeparator`, types, utilities)
- [x] 5.3 Run `bun run typecheck` and a targeted Playwright test (`npx playwright test tests/toolbar-state.spec.ts --timeout=30000`) to verify no regressions

## 6. Integrate into DocxEditor

- [x] 6.1 Add new props to `DocxEditorProps`: `toolbarLayout?: 'classic' | 'google-docs'`, `renderLogo?: () => ReactNode`, `documentName?: string`, `onDocumentNameChange?: (name: string) => void`, `renderTitleBarRight?: () => ReactNode`
- [x] 6.2 Update the toolbar rendering section in `DocxEditor.tsx` — when `toolbarLayout="google-docs"`, render `EditorToolbar` with `TitleBar` (populated from new props) + `FormattingBar` (with existing toolbar children + toolbarExtra). When `"classic"` (default), render existing `Toolbar` unchanged
- [x] 6.3 Run `bun run typecheck` to verify types

## 7. Update Package Exports

- [x] 7.1 Add `EditorToolbar` and related types to `src/index.ts` exports (EditorToolbar, EditorToolbarProps, FormattingBar, TitleBar, Logo, DocumentName, MenuBar, TitleBarRight)
- [x] 7.2 Run `bun run typecheck` to verify exports compile

## 8. Update Demo Apps

- [x] 8.1 Update `examples/vite/src/App.tsx` to use `toolbarLayout="google-docs"` — move GitHubBadge + ExampleSwitcher into `renderLogo`, use `documentName`/`onDocumentNameChange` for filename, move Open DOCX/New/Save/toggle into `renderTitleBarRight`. Remove the separate custom header
- [x] 8.2 Update `examples/nextjs/app/components/Editor.tsx` to use the same `toolbarLayout="google-docs"` pattern
- [x] 8.3 Visually verify both demos in browser (`bun run dev` in examples/vite)

## 9. Documentation

- [x] 9.1 Create `docs/TOOLBAR.md` with overview section explaining the 2-level Google Docs-style toolbar concept and the two API approaches (compound components vs DocxEditor props)
- [x] 9.2 Add compound component API section to `docs/TOOLBAR.md` with full usage example showing `EditorToolbar` with all sub-components and props tables for each sub-component (`EditorToolbar`, `TitleBar`, `Logo`, `DocumentName`, `MenuBar`, `TitleBarRight`, `FormattingBar`)
- [x] 9.3 Add DocxEditor props shortcut section to `docs/TOOLBAR.md` with usage example of `toolbarLayout="google-docs"` and props table for new DocxEditor props
- [x] 9.4 Add migration guide section to `docs/TOOLBAR.md` showing how to move from classic layout with external header to google-docs layout (before/after code examples)
- [x] 9.5 Add customization patterns section to `docs/TOOLBAR.md` with code examples: custom logo, custom right-side actions, passing `toolbarExtra`, combining compound components with custom elements
- [x] 9.6 Update `docs/PROPS.md` to add new DocxEditor props (`toolbarLayout`, `renderLogo`, `documentName`, `onDocumentNameChange`, `renderTitleBarRight`) to the props table

## 10. Testing and Validation

- [x] 10.1 Run full typecheck: `bun run typecheck`
- [x] 10.2 Run toolbar-related Playwright tests: `npx playwright test tests/toolbar-state.spec.ts --timeout=30000 --workers=4`
- [x] 10.3 Run formatting tests to verify no regressions: `npx playwright test tests/formatting.spec.ts --timeout=30000 --workers=4`
- [x] 10.4 Visual test: open demo in Chrome, verify 2-level toolbar renders correctly with all slots, menus work, formatting buttons work, editor focus is preserved
