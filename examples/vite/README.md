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

| File                        | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `src/main.tsx`              | React root; mounts the one editor                                 |
| `src/ComposedEditorDemo.tsx`| The editor: composition API, custom header, library toolbar       |
| `src/ThemeToggle.tsx`       | Light/dark switch used by the demo header                         |
| `src/demoButtons.ts`        | Inline button styles for the demo header                          |
| `src/styles.css`            | Demo-only chrome styles (the library ships its own)               |
| `src/test-harness/`         | Playwright-only tree-binding harness (`?treeFirst=1`), not a surface |
| `index.html`                | Loads the Material Symbols font for toolbar icons                 |
| `vite.config.ts`            | Aliases `@docx-editor.dev/*` to workspace source in dev           |

The default document is served from `e2e/fixtures/` by a vite plugin, so the demo and
the e2e suite read the same bytes. `?fixture=<name>.docx` loads any `.docx` in `public/`
instead.

## Minimal integration

A working editor is one component. Chrome and English labels are the default:

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);

  const handleSave = async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) await fetch('/api/documents/1', { method: 'PUT', body: buffer });
  };

  return <DocxEditor ref={editorRef} document={file} onSave={handleSave} />;
}
```

`document` takes an `ArrayBuffer`, a `Uint8Array`, or an existing
`DocumentHandle`. `fonts` is optional: omit it and the engine resolves faces
from the document's own embedded fonts.

Chrome labels default to the bundled English catalogue. To show another language,
pass `t` — any function from an i18n key to display text. The keys are the ones in
`packages/i18n/en.json`, and `@docx-editor.dev/i18n` ships the translated
catalogues plus a `createT` helper:

```tsx
import { createT, de } from '@docx-editor.dev/i18n';

<DocxEditor ref={editorRef} document={file} t={createT(de, 'de')} />;
```

`chrome={false}` renders the painted document alone, for hosts supplying their own
frame.

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
