# Toolbar

## Overview

The current React package exposes its toolbar and surrounding chrome from the
package root. The packaged host is `<DocxEditor />`, and the lower-level
provider/hooks/compound API is also rooted there.

### Layout Structure

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

There are **two current ways** to customize the toolbar:

1. **React root props** for the packaged host
2. **Provider primitives + compounds** from `@docx-editor.dev/react`

---

## Quick setup (React root props)

The simplest way to customize the toolbar:

```tsx
import { DocxEditor } from '@docx-editor.dev/react';

function App() {
  const [title, setTitle] = useState('Untitled.docx');

  return (
    <DocxEditor
      document={bytes}
      title={title}
      onTitleChange={setTitle}
      renderTitleBarRight={() => (
        <div>
          <button onClick={handleSave}>Save</button>
        </div>
      )}
    />
  );
}
```

### React root toolbar props

| Prop                  | Type                             | Default | Description                                       |
| --------------------- | -------------------------------- | ------- | ------------------------------------------------- |
| `title`               | `string`                         | —       | Document title displayed in the title bar         |
| `onTitleChange`       | `(name: string) => void`         | —       | Called when the user edits the document title     |
| `renderTitleBarLeft`  | `() => ReactNode`                | —       | Custom left title-bar slot                        |
| `renderTitleBarRight` | `() => ReactNode`                | —       | Custom actions on the right side of the title bar |
| `menu`                | `boolean \| DocxEditorMenuProps` | —       | Toggle or customize the packaged menu row         |
| `chrome`              | `boolean`                        | `true`  | Toggle the packaged frame                         |

## Provider primitives and compounds

For full control, compose the same root exports the packaged host uses internally:

```tsx
import { DocxEditor, useEditorCommand } from '@docx-editor.dev/react';

function BoldButton() {
  const bold = useEditorCommand('text.bold');
  return (
    <button onClick={() => bold.execute()} disabled={!bold.isEnabled}>
      Bold
    </button>
  );
}

function MyEditor({ bytes }: { bytes: Uint8Array }) {
  return (
    <DocxEditor.Root document={bytes}>
      <DocxEditor.Toolbar>
        <BoldButton />
      </DocxEditor.Toolbar>
      <DocxEditor.Viewport>
        <DocxEditor.Navigation />
        <DocxEditor.Content />
        <DocxEditor.HyperLink />
        <DocxEditor.ContextMenu />
      </DocxEditor.Viewport>
    </DocxEditor.Root>
  );
}
```

`DocxEditor.Root` owns the editor instance, `DocxEditor.Viewport` is the scroll
container, and `DocxEditor.Content` is the painted page surface. The other
compounds (`DocxEditor.Toolbar`, `DocxEditor.Menu`, `DocxEditor.Navigation`,
`DocxEditor.HyperLink`, `DocxEditor.ContextMenu`) layer on top of that same
provider.
