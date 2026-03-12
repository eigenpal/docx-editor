# Toolbar

## Overview

The editor supports two toolbar layouts:

- **`classic`** (default) — Single-row toolbar with menus and formatting icons side by side
- **`google-docs`** — Two-level composable toolbar with a title bar and a formatting bar

Both layouts are fully functional — they share the same formatting engine and keyboard shortcuts.

### Two-Level Layout Structure

```
┌──────────┬────────────────────────────────┬──────────────────────┐
│          │ Document Name                  │                      │
│  Logo    │                                │  Right Actions       │
│          │ File  Format  Insert           │                      │
├──────────┴────────────────────────────────┴──────────────────────┤
│ ╭─ Formatting Bar (rounded pill) ─────────────────────────────╮ │
│ │ ↩ ↪  100% ▾  Normal ▾  Inter ▾  — 32 +  B I U  A▾ 🖌▾ ... │ │
│ ╰─────────────────────────────────────────────────────────────╯ │
└─────────────────────────────────────────────────────────────────┘
```

- **Title Bar**: 3-column layout — Logo and Right Actions span full height, Document Name + Menus stack vertically in the center
- **Formatting Bar**: Rendered inside a rounded pill with a subtle gray background
- Every slot is customizable — pass your own logo, action buttons, or extra toolbar items

There are **two ways** to use the two-level toolbar:

1. **DocxEditor props** — Quick setup using `toolbarLayout="google-docs"` with render props
2. **Compound components** — Full control using `EditorToolbar` and its sub-components

---

## Quick Setup (DocxEditor Props)

The simplest way to get the two-level toolbar:

```tsx
import { DocxEditor } from '@eigenpal/docx-js-editor';

function App() {
  const [fileName, setFileName] = useState('Untitled.docx');

  return (
    <DocxEditor
      documentBuffer={buffer}
      toolbarLayout="google-docs"
      renderLogo={() => <img src="/logo.svg" alt="Logo" />}
      documentName={fileName}
      onDocumentNameChange={setFileName}
      renderTitleBarRight={() => (
        <div>
          <button onClick={handleSave}>Save</button>
        </div>
      )}
    />
  );
}
```

### DocxEditor Toolbar Props

| Prop                   | Type                         | Default     | Description                                               |
| ---------------------- | ---------------------------- | ----------- | --------------------------------------------------------- |
| `toolbarLayout`        | `'classic' \| 'google-docs'` | `'classic'` | Toolbar layout style                                      |
| `renderLogo`           | `() => ReactNode`            | —           | Custom logo/icon in the title bar (two-level layout only) |
| `documentName`         | `string`                     | —           | Editable document name displayed in the title bar         |
| `onDocumentNameChange` | `(name: string) => void`     | —           | Called when the user edits the document name              |
| `renderTitleBarRight`  | `() => ReactNode`            | —           | Custom actions on the right side of the title bar         |

All existing toolbar props (`showToolbar`, `showZoomControl`, `showRuler`, `toolbarExtra`, etc.) continue to work with both layouts.

---

## Compound Component API

For full control over the toolbar structure, use `EditorToolbar` directly:

```tsx
import { EditorToolbar, type EditorToolbarProps } from '@eigenpal/docx-js-editor';

function MyEditor({ toolbarProps }: { toolbarProps: EditorToolbarProps }) {
  return (
    <EditorToolbar {...toolbarProps}>
      <EditorToolbar.TitleBar>
        <EditorToolbar.Logo>
          <img src="/logo.svg" alt="My App" />
        </EditorToolbar.Logo>
        <EditorToolbar.DocumentName
          value={fileName}
          onChange={setFileName}
          placeholder="Untitled"
        />
        <EditorToolbar.MenuBar />
        <EditorToolbar.TitleBarRight>
          <button onClick={handleSave}>Save</button>
          <button onClick={handleShare}>Share</button>
        </EditorToolbar.TitleBarRight>
      </EditorToolbar.TitleBar>
      <EditorToolbar.FormattingBar />
    </EditorToolbar>
  );
}
```

### Sub-Components

#### `EditorToolbar`

The root wrapper. Provides toolbar context to all sub-components.

| Prop              | Type        | Description                                                   |
| ----------------- | ----------- | ------------------------------------------------------------- |
| `children`        | `ReactNode` | Sub-components (TitleBar, FormattingBar)                      |
| `className`       | `string`    | Additional CSS class for the container                        |
| _...ToolbarProps_ |             | All standard toolbar props (formatting state, handlers, etc.) |

#### `EditorToolbar.TitleBar`

Three-column layout. Automatically arranges children:

- **Left column**: Logo (spans full height)
- **Center column**: DocumentName on top, MenuBar below
- **Right column**: TitleBarRight (spans full height)

| Prop       | Type        | Description                                |
| ---------- | ----------- | ------------------------------------------ |
| `children` | `ReactNode` | Logo, DocumentName, MenuBar, TitleBarRight |

#### `EditorToolbar.Logo`

Renders custom content (icon, image, badge) left-aligned in the title bar.

| Prop       | Type        | Description  |
| ---------- | ----------- | ------------ |
| `children` | `ReactNode` | Logo content |

#### `EditorToolbar.DocumentName`

Editable text input styled as a borderless field.

| Prop          | Type                      | Default      | Description           |
| ------------- | ------------------------- | ------------ | --------------------- |
| `value`       | `string`                  | —            | Current document name |
| `onChange`    | `(value: string) => void` | —            | Called on name change |
| `placeholder` | `string`                  | `'Untitled'` | Placeholder text      |

#### `EditorToolbar.MenuBar`

Renders File, Format, and Insert dropdown menus. Automatically wired to the toolbar context — no props needed.

Menu contents are derived from the toolbar context (print, page setup, text direction, image/table insert, page break, table of contents).

#### `EditorToolbar.TitleBarRight`

Right-aligned container for custom actions (buttons, toggles, status indicators).

| Prop       | Type        | Description                   |
| ---------- | ----------- | ----------------------------- |
| `children` | `ReactNode` | Action buttons, toggles, etc. |

#### `EditorToolbar.FormattingBar`

The icon formatting toolbar (undo/redo, zoom, fonts, bold/italic/underline, colors, alignment, lists, etc.) rendered inside a rounded pill with a subtle gray background. Can also be used standalone outside of `EditorToolbar`.

| Prop       | Type        | Description                                                             |
| ---------- | ----------- | ----------------------------------------------------------------------- |
| `children` | `ReactNode` | Additional toolbar items appended at the end                            |
| `inline`   | `boolean`   | When true, renders with `display: contents` for embedding in a flex row |

---

## Migration Guide

### Before: Classic layout with custom header

```tsx
function App() {
  return (
    <div>
      {/* Custom header above the editor */}
      <header>
        <img src="/logo.svg" />
        <span>{fileName}</span>
        <button onClick={handleSave}>Save</button>
      </header>

      <DocxEditor documentBuffer={buffer} showToolbar={true} />
    </div>
  );
}
```

### After: Two-level layout with integrated title bar

```tsx
function App() {
  return (
    <DocxEditor
      documentBuffer={buffer}
      showToolbar={true}
      toolbarLayout="google-docs"
      renderLogo={() => <img src="/logo.svg" />}
      documentName={fileName}
      onDocumentNameChange={setFileName}
      renderTitleBarRight={() => <button onClick={handleSave}>Save</button>}
    />
  );
}
```

The custom header is no longer needed — logo, document name, and action buttons are all integrated into the toolbar's title bar row.

---

## Customization Patterns

### Custom logo with branding

```tsx
<DocxEditor
  toolbarLayout="google-docs"
  renderLogo={() => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <img src="/logo.svg" width={24} height={24} />
      <span style={{ fontWeight: 600 }}>My App</span>
    </div>
  )}
/>
```

### Right-side actions with status

```tsx
<DocxEditor
  toolbarLayout="google-docs"
  renderTitleBarRight={() => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#666' }}>Saved</span>
      <button onClick={handleExport}>Export</button>
      <button onClick={handleShare}>Share</button>
    </div>
  )}
/>
```

### Extra formatting toolbar items

Use `toolbarExtra` to append custom buttons to the formatting bar:

```tsx
<DocxEditor
  toolbarLayout="google-docs"
  toolbarExtra={
    <>
      <button onClick={handleSpellCheck}>Spell Check</button>
      <button onClick={handleWordCount}>Word Count</button>
    </>
  }
/>
```

### Compound components with custom elements

Mix standard sub-components with your own elements inside the TitleBar:

```tsx
<EditorToolbar {...toolbarProps}>
  <EditorToolbar.TitleBar>
    <EditorToolbar.Logo>
      <MyBrandLogo />
    </EditorToolbar.Logo>
    <EditorToolbar.DocumentName value={name} onChange={setName} />
    <EditorToolbar.MenuBar />
    <EditorToolbar.TitleBarRight>
      <UserAvatar />
      <ShareButton />
      <SaveButton />
    </EditorToolbar.TitleBarRight>
  </EditorToolbar.TitleBar>
  <EditorToolbar.FormattingBar>
    <CustomToolbarButton icon="spell_check" onClick={handleSpellCheck} />
  </EditorToolbar.FormattingBar>
</EditorToolbar>
```
