# Vite example

`@docx-editor.dev/react` in a plain Vite + React SPA. One editor, no surface
picker: what you see here is what the package gives you.

## Run it

From the repo root:

```bash
bun install
bun run dev:react      # http://localhost:5173
```

Or from this directory: `bun run dev`.

## Files

| File                               | What it does                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/main.tsx`                     | React root; mounts the one editor                                   |
| `../shared/ComposedEditorDemo.tsx` | The editor: composition API, custom header, library toolbar         |
| `src/test-harness/`                | Playwright-only tree-binding harness (`?treeFirst=1`), not a surface |
| `index.html`                       | Loads the Material Symbols font for toolbar icons                   |
| `vite.config.ts`                   | Aliases `@docx-editor.dev/*` to workspace source in dev             |

`?fixture=<name>.docx` swaps the loaded document for any `.docx` in `public/`.

## Minimal integration

A working editor is one component:

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);

  const handleSave = async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) await fetch('/api/documents/1', { method: 'PUT', body: buffer });
  };

  return (
    <>
      <button onClick={handleSave}>Save</button>
      <DocxEditor ref={editorRef} document={file} />
    </>
  );
}
```

`document` takes an `ArrayBuffer`, a `Uint8Array`, or an existing
`DocumentHandle`. `fonts` is optional: omit it and the engine resolves faces
from the document's own embedded fonts.

That mounts the bare document surface, editable and saveable, with no chrome.
Pass `t` to get the packaged chrome (title bar + full toolbar):

```tsx
import { createT, en } from '@docx-editor.dev/i18n';

const t = createT(en);

<DocxEditor ref={editorRef} document={file} t={t} onSave={handleSave} />;
```

Chrome is gated on `t` because every label is an i18n key. The adapter ships no
English of its own, so `en` is an explicit import rather than a bundled default.

## Building your own chrome

`DocxEditor` is sugar over primitives you can use directly, which is what
`ComposedEditorDemo` does: a custom header built from `useDocxEditor`,
`useEditorState`, `useEditorCommand` and `useFontFamily`, with the library
toolbar alongside it and one slot overridden in place.

```tsx
<DocxEditor.Root document={bytes}>
  <YourHeader />
  <DocxEditor.Toolbar t={t} />
  <DocxEditor.Viewport>
    <DocxEditor.Content />
  </DocxEditor.Viewport>
</DocxEditor.Root>
```

## Use it in your own Vite app

```bash
npm install @docx-editor.dev/react
```

The toolbar icons need the Material Symbols font, add this to `index.html`:

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
/>
```

Docs: https://www.docx-editor.dev/docs/1.x/react
