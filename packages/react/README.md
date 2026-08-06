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

WYSIWYG `.docx` editor for React. Opens a Word file in the browser, paints the real paginated
layout, edits it in place, and writes a `.docx` back out. No upload service, no conversion
backend: parsing and serialization both happen client-side.

Saving is lossless. Everything you do not edit comes back byte for byte, including the parts
the editor does not understand: custom XML, embedded fonts, macros, unknown extensions. Two
oracles gate that in CI, so opening a document here cannot quietly destroy it.

```bash
npm install @docx-editor.dev/react
```

## Quick start

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

`<DocxEditor>` is the full packaged editor: title bar, menu, toolbar, navigation pane,
context menu, and the painted document. It fills its parent, so give it a box with a real
height, and import the stylesheet once.

> **Next.js / SSR:** the editor measures text in the DOM at mount, so render it client-side
> (`dynamic(..., { ssr: false })`).

## Build your own UI

The packaged chrome is one arrangement of public parts. Every packaged control uses the same
hooks you would; there is no private API behind it.

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
      B
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

`Root` owns the editor instance, `Viewport` is the scroll container, `Content` is where pages
are painted. Everything else (toolbar, menu, rulers, navigation, link popover, context menu)
is optional and placed by name.

The customization ladder, in order: `className` and `data-active` → the `icon` prop →
`asChild` (merge behavior onto your own element) → in-place slot override (`hidden`,
`preset={false}`) → the hooks.

## Hooks

| Hook                                           | What it gives you                                    |
| ---------------------------------------------- | ---------------------------------------------------- |
| `useEditorCommand(slot)`                       | `execute`, `isActive`, `isEnabled`, `disabledReason` |
| `useEditorState(selector)`                     | A memoized slice of the editor snapshot              |
| `useDocxEditor()`                              | The editor instance, or `null` before mount          |
| `useEditorEvent(event, fn)`                    | `change`, `selectionChange`, `error`                 |
| `useFontFamily()` / `useParagraphStyle()`      | Value controls: current value, options, setter       |
| `usePageSetup()`                               | Margins, orientation, paper size                     |
| `useDocumentOutline()` / `useDocumentSearch()` | The navigation pane, headless                        |
| `useContentControl()`                          | Word content controls at the caret                   |

Enabled state has exactly one source. A control that hardcodes `disabled` will drift from the
engine. Read `isEnabled` and show `disabledReason`.

## Companion packages

- [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro) — tracked
  changes, comments, custom nodes
- [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) —
  Office.js-compatible editing API, on a server or against an open editor
- [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) — the engine
  this adapter renders

## Documentation

- [Quickstart](https://www.docx-editor.dev/docs/2.x/quickstart)
- [Composition](https://www.docx-editor.dev/docs/2.x/react/composition)
- [Hooks](https://www.docx-editor.dev/docs/2.x/react/hooks)
- [Props and ref](https://www.docx-editor.dev/docs/2.x/react/props)

## License

Apache-2.0
