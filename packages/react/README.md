<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/v/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/react

A visual `.docx` editor for React. Open a Word document, edit its paginated layout, and save a DOCX file. Parsing and serialization run in the browser.

Saving preserves untouched content, unsupported OOXML, and package payloads. Continuous integration (CI) checks document structure and save-and-reopen behavior.

Install the adapter and its required engine peer:

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

## Quick start

Import the stylesheet once and give the editor a container with a defined height:

```tsx
import { useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import '@docx-editor.dev/core/styles/editor.css';

export function App() {
  const [doc, setDoc] = useState<Uint8Array>();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <input
        type="file"
        accept=".docx"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setDoc(file ? new Uint8Array(await file.arrayBuffer()) : undefined);
        }}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {doc && <DocxEditor document={doc} mode="edit" />}
      </div>
    </div>
  );
}
```

`<DocxEditor>` includes the title bar, menu, toolbar, navigation pane, context menu, and document pages. It fills its parent container.

For Next.js and server-side rendering (SSR), load the editor in the browser. Use `dynamic(..., { ssr: false })` inside a Client Component.

## Build your own UI

Use components and hooks to build your own controls. Packaged controls use the same public API.

```tsx
import { DocxEditor, useEditorCommand } from '@docx-editor.dev/react';

function BoldButton() {
  const bold = useEditorCommand('text.bold');
  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // chrome must not steal the caret
      onClick={() => bold.execute()}
      disabled={!bold.isEnabled}
      data-active={bold.isActive || undefined}
    >
      Bold
    </button>
  );
}

export function Editor({ bytes }: { bytes: Uint8Array }) {
  return (
    <DocxEditor.Root document={bytes}>
      <BoldButton />
      <DocxEditor.Viewport>
        <DocxEditor.Content />
      </DocxEditor.Viewport>
    </DocxEditor.Root>
  );
}
```

`Root` owns the editor instance. `Viewport` supplies scrolling, and `Content` displays pages. Add other controls as needed.

Use `className`, `data-active`, and `icon` for appearance changes. Use `asChild` to apply behavior to your own element. Use `hidden` or `preset={false}` to replace controls, or build controls with hooks.

## Hooks

| Hook | What it gives you |
| --- | --- |
| `useEditorCommand(slot)` | `execute`, `isActive`, `isEnabled`, `disabledReason` |
| `useEditorState(selector)` | A memoized slice of the editor snapshot |
| `useDocxEditor()` | The editor instance, or `null` before mount |
| `useEditorEvent(event, fn)` | `change`, `selectionChange`, `error` |
| `useFontFamily()` / `useParagraphStyle()` | Value controls: current value, options, setter |
| `usePageSetup()` | Margins, orientation, paper size |
| `useDocumentOutline()` / `useDocumentSearch()` | The navigation pane, headless |
| `useContentControl()` | Word content controls at the caret |

Read `isEnabled` to set the disabled state. Show `disabledReason` when the command is unavailable.

## Companion packages

- [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro) — tracked changes, comments, custom nodes
- [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) — A supported subset of the Word Office.js API for server and browser editing
- [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) — the engine this adapter renders

## Documentation

- [Quickstart](https://www.docx-editor.dev/docs/2.x/quickstart)
- [Composition](https://www.docx-editor.dev/docs/2.x/react/composition)
- [Hooks](https://www.docx-editor.dev/docs/2.x/react/hooks)
- [Props and ref](https://www.docx-editor.dev/docs/2.x/react/props)

## Export Markdown and PDF

The adapter does not install either converter. Install only the formats your application uses.

Configure `menu.exporters` to enable **File > Export** with the conversion packages. Markdown downloads as one continuous document. PDF conversion requires a Node.js server. Missing converter handlers show an error with setup instructions. See [Export Markdown and PDF](https://www.docx-editor.dev/docs/2.x/guides/export).

**File > Print** uses the same PDF handler and opens the browser print dialog. Press Ctrl+P, or Cmd+P on macOS. See [Print documents](https://www.docx-editor.dev/docs/2.x/guides/print).

## Accept server updates

Use `createDocumentRefresh(editor)` to accept complete DOCX results from your server. The controller preserves the editor instance and scroll position. Each accepted file resets selection and undo history. Results after local edits and collaborative sessions are refused.

For highlights, change navigation, and recovery, see [Document refresh API](https://www.docx-editor.dev/docs/2.x/guides/document-refresh).

## License

Apache-2.0
