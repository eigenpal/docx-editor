## ADDED Requirements

### Requirement: EditorToolbar compound component renders a 2-level toolbar

The system SHALL provide an `EditorToolbar` compound component that renders a Google Docs-style 2-level toolbar with a title bar (top row) and a formatting bar (bottom row). `EditorToolbar` SHALL accept the same props as the current `Toolbar` component (formatting state, handlers, visibility flags) and provide them to sub-components via React Context.

#### Scenario: Basic 2-level toolbar renders correctly

- **WHEN** `EditorToolbar` is rendered with `TitleBar` and `FormattingBar` sub-components
- **THEN** the title bar SHALL appear as the top row and the formatting bar SHALL appear as the bottom row, each on their own horizontal line

#### Scenario: EditorToolbar passes toolbar state to sub-components via context

- **WHEN** `EditorToolbar` receives `currentFormatting`, `onFormat`, `onUndo`, `onRedo`, and other toolbar props
- **THEN** `FormattingBar` and `MenuBar` sub-components SHALL access these props via `EditorToolbarContext` without prop drilling

### Requirement: TitleBar renders logo, document name, menus, and right-side actions

The system SHALL provide `EditorToolbar.TitleBar` as a compound sub-component that lays out its children in a two-row structure: first row has logo + document name + right-side actions, second row has the menu bar.

#### Scenario: TitleBar with all slots populated

- **WHEN** `TitleBar` contains `Logo`, `DocumentName`, `MenuBar`, and `TitleBarRight` sub-components
- **THEN** the logo SHALL appear left-aligned, document name SHALL appear next to the logo, the right-side actions SHALL appear right-aligned on the same row, and the menu bar SHALL appear on a second row below

#### Scenario: TitleBar with only menu bar

- **WHEN** `TitleBar` contains only `MenuBar` (no logo, name, or right actions)
- **THEN** only the menu bar row SHALL render, with no empty space for missing slots

### Requirement: Logo slot accepts custom content

The system SHALL provide `EditorToolbar.Logo` as a sub-component that renders its children as the logo/icon in the title bar.

#### Scenario: Custom logo renders in title bar

- **WHEN** `EditorToolbar.Logo` wraps a custom React element (e.g., an SVG icon)
- **THEN** that element SHALL render as the leftmost item in the title bar's first row

#### Scenario: No logo provided

- **WHEN** `EditorToolbar.Logo` is not included in `TitleBar`
- **THEN** no logo space SHALL be rendered and the document name (if present) SHALL be the leftmost element

### Requirement: DocumentName provides an editable document name input

The system SHALL provide `EditorToolbar.DocumentName` as a controlled input component with `value` and `onChange` props.

#### Scenario: Document name displays and is editable

- **WHEN** `DocumentName` is rendered with `value="My Document"` and an `onChange` handler
- **THEN** the text "My Document" SHALL display as an editable input field in the title bar
- **AND** typing in the field SHALL call `onChange` with the new value

#### Scenario: Document name with placeholder

- **WHEN** `DocumentName` is rendered with an empty `value` and `placeholder="Untitled"`
- **THEN** the placeholder text "Untitled" SHALL appear in a muted style

### Requirement: MenuBar renders File, Format, and Insert menus

The system SHALL provide `EditorToolbar.MenuBar` as a sub-component that renders the File, Format, and Insert dropdown menus. Menu items and handlers SHALL be auto-populated from `EditorToolbarContext`.

#### Scenario: MenuBar renders all three menus

- **WHEN** `MenuBar` is rendered and the context has `onPrint`, `onPageSetup`, `onFormat`, `onInsertImage`, `onInsertTable`, `onInsertPageBreak`, and `onInsertTOC` handlers
- **THEN** File menu SHALL contain Print and Page setup items
- **AND** Format menu SHALL contain Left-to-right and Right-to-left text items
- **AND** Insert menu SHALL contain Image, Table, Page break, and Table of contents items

#### Scenario: MenuBar conditionally shows File menu

- **WHEN** the context has no `onPrint` and no `onPageSetup` handlers
- **THEN** the File menu SHALL not render

### Requirement: TitleBarRight renders custom right-side actions

The system SHALL provide `EditorToolbar.TitleBarRight` as a sub-component that renders its children right-aligned in the title bar's first row.

#### Scenario: Right-side actions render correctly

- **WHEN** `TitleBarRight` contains buttons for "Open DOCX", "New", and "Save"
- **THEN** these buttons SHALL appear right-aligned in the first row of the title bar

### Requirement: FormattingBar renders icon-based formatting tools

The system SHALL provide `EditorToolbar.FormattingBar` as a sub-component that renders all icon-based formatting controls: undo/redo, zoom, style picker, font family/size, bold/italic/underline/strikethrough, text/highlight colors, link, superscript/subscript, alignment, lists, line spacing, image controls, table controls, clear formatting, and a children slot.

#### Scenario: FormattingBar renders same controls as current toolbar minus menus

- **WHEN** `FormattingBar` is rendered with full toolbar context
- **THEN** it SHALL render all the same formatting controls currently in `Toolbar.tsx` (lines 804-1073) except the File, Format, and Insert menus

#### Scenario: FormattingBar respects visibility flags

- **WHEN** the context has `showFontPicker=false` and `showAlignmentButtons=false`
- **THEN** the font picker and alignment buttons SHALL not render in the formatting bar

#### Scenario: FormattingBar accepts children for custom items

- **WHEN** `FormattingBar` receives `children` (e.g., a comments toggle button)
- **THEN** those children SHALL render at the end of the formatting bar, after clear formatting

### Requirement: DocxEditor supports toolbarLayout prop

The system SHALL add a `toolbarLayout` prop to `DocxEditor` with values `'classic'` (default) and `'google-docs'`. When `'classic'`, the current single-row toolbar SHALL render unchanged. When `'google-docs'`, the 2-level `EditorToolbar` SHALL render.

#### Scenario: Classic layout is default and unchanged

- **WHEN** `DocxEditor` is rendered without `toolbarLayout` or with `toolbarLayout="classic"`
- **THEN** the toolbar SHALL render as a single row with menus + formatting icons (current behavior)

#### Scenario: Google Docs layout renders 2-level toolbar

- **WHEN** `DocxEditor` is rendered with `toolbarLayout="google-docs"`
- **THEN** the toolbar area SHALL render the `EditorToolbar` with `TitleBar` (containing menus) on top and `FormattingBar` below

### Requirement: DocxEditor props-based shortcut for Google Docs layout

The system SHALL add `renderLogo`, `documentName`, `onDocumentNameChange`, and `renderTitleBarRight` props to `DocxEditor`. These SHALL be used when `toolbarLayout="google-docs"` to populate the title bar slots.

#### Scenario: Props-based Google Docs toolbar

- **WHEN** `DocxEditor` is rendered with `toolbarLayout="google-docs"`, `renderLogo={() => <MyIcon />}`, `documentName="Report.docx"`, `onDocumentNameChange={setName}`, and `renderTitleBarRight={() => <button>Save</button>}`
- **THEN** the title bar SHALL show the custom logo, an editable document name "Report.docx", the menu bar, and a "Save" button on the right

#### Scenario: Google Docs layout without optional props

- **WHEN** `DocxEditor` is rendered with `toolbarLayout="google-docs"` but no `renderLogo`, `documentName`, or `renderTitleBarRight`
- **THEN** the title bar SHALL render only the menu bar row (no logo, no name, no right actions)

### Requirement: toolbarExtra still works in both layouts

The system SHALL continue to support the `toolbarExtra` prop on `DocxEditor`, appending custom ReactNode content to the formatting bar in both `'classic'` and `'google-docs'` layouts.

#### Scenario: toolbarExtra in classic layout

- **WHEN** `DocxEditor` has `toolbarLayout="classic"` and `toolbarExtra={<button>Custom</button>}`
- **THEN** the custom button SHALL appear at the end of the single-row toolbar

#### Scenario: toolbarExtra in google-docs layout

- **WHEN** `DocxEditor` has `toolbarLayout="google-docs"` and `toolbarExtra={<button>Custom</button>}`
- **THEN** the custom button SHALL appear at the end of the formatting bar (bottom row)

### Requirement: New components are exported from package index

The system SHALL export `EditorToolbar` and all its sub-components (`TitleBar`, `Logo`, `DocumentName`, `MenuBar`, `TitleBarRight`, `FormattingBar`) from `src/index.ts`.

#### Scenario: Named exports available

- **WHEN** a consumer imports from `@eigenpal/docx-js-editor`
- **THEN** `EditorToolbar` SHALL be available as a named export
- **AND** sub-components SHALL be accessible as `EditorToolbar.TitleBar`, `EditorToolbar.Logo`, etc.

### Requirement: Toolbar focus management preserved

The system SHALL maintain the current focus management behavior: mousedown on toolbar/title bar elements SHALL prevent focus theft from the ProseMirror editor, and mouseup SHALL refocus the editor via `onRefocusEditor`.

#### Scenario: Clicking formatting bar buttons does not steal editor focus

- **WHEN** user clicks a bold button in the `FormattingBar`
- **THEN** the ProseMirror editor SHALL retain focus and the bold formatting SHALL be applied to the selection

#### Scenario: Clicking title bar menus does not steal editor focus

- **WHEN** user opens the Insert menu in the `MenuBar` and clicks "Image"
- **THEN** the editor SHALL retain focus after the menu closes

### Requirement: API documentation for composable toolbar

The system SHALL provide documentation in `docs/TOOLBAR.md` covering the composable toolbar API with usage examples for both the compound component API and the DocxEditor props-based shortcut.

#### Scenario: Documentation covers compound component API

- **WHEN** a developer reads `docs/TOOLBAR.md`
- **THEN** they SHALL find a complete usage example of `EditorToolbar` with all sub-components (`TitleBar`, `Logo`, `DocumentName`, `MenuBar`, `TitleBarRight`, `FormattingBar`)
- **AND** each sub-component SHALL have its props documented in a table

#### Scenario: Documentation covers DocxEditor props shortcut

- **WHEN** a developer reads `docs/TOOLBAR.md`
- **THEN** they SHALL find a usage example of `DocxEditor` with `toolbarLayout="google-docs"` and the `renderLogo`, `documentName`, `onDocumentNameChange`, `renderTitleBarRight` props
- **AND** a props table SHALL list all new DocxEditor toolbar props with types, defaults, and descriptions

#### Scenario: Documentation covers migration from classic to google-docs layout

- **WHEN** a developer currently uses the classic toolbar with `toolbarExtra`
- **THEN** `docs/TOOLBAR.md` SHALL include a migration guide showing how to move from classic layout with custom header to the google-docs layout

#### Scenario: Documentation covers customization patterns

- **WHEN** a developer wants to customize specific slots (e.g., custom logo, custom right-side buttons, extra menu items)
- **THEN** `docs/TOOLBAR.md` SHALL include code examples for each common customization pattern

#### Scenario: PROPS.md is updated with new DocxEditor props

- **WHEN** a developer reads `docs/PROPS.md`
- **THEN** the new props (`toolbarLayout`, `renderLogo`, `documentName`, `onDocumentNameChange`, `renderTitleBarRight`) SHALL be listed in the props table
