# Vite example

This Vite and React app shows the editor composition API with custom chrome.

## Run the example

From the repository root, run:

```bash
bun install
bun run dev:react
```

Open `http://localhost:5173`.

The default document is `public/sample.docx`. In development,
`?fixture=<name>.docx` resolves a file with that name from `e2e/fixtures/`.
Production builds include only the fixtures listed in `vite.config.ts`.

## Add the editor to Vite

Install the adapter and its engine peer:

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Import `@docx-editor.dev/core/styles/editor.css` once in your application entry.
Then render the editor:

```tsx
import '@docx-editor.dev/core/styles/editor.css';
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

## Build custom chrome

`src/ComposedEditorDemo.tsx` uses the editor primitives and hooks directly.

```tsx
<DocxEditor.Root document={bytes}>
  <YourHeader />
  <DocxEditor.Toolbar t={t} />
  <DocxEditor.Viewport>
    <DocxEditor.Content />
  </DocxEditor.Viewport>
</DocxEditor.Root>
```

For more information, see the
[React adapter guide](https://www.docx-editor.dev/docs/2.x/react).
