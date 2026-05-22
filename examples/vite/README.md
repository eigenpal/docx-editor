# Vite example

`@eigenpal/docx-editor-react` in a plain Vite + React SPA. No SSR, so the
editor mounts directly with no lazy-loading wrapper. The simplest of the
examples. Start here.

## Run it

From the repo root:

```bash
bun install
bun run dev:react      # http://localhost:5173
```

Or from this directory: `bun run dev`.

## Files

| File             | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `src/App.tsx`    | The editor: open `.docx`, edit, render an agent panel |
| `src/main.tsx`   | React root + `styles.css`                             |
| `index.html`     | Loads the Material Symbols font for toolbar icons     |
| `vite.config.ts` | Aliases `@eigenpal/*` to workspace source in dev      |

## Minimal integration

```tsx
import { DocxEditor } from '@eigenpal/docx-editor-react';
import { createEmptyDocument } from '@eigenpal/docx-editor-core';

export default function App() {
  return <DocxEditor document={createEmptyDocument()} showToolbar />;
}
```

To open a real file, read it as an `ArrayBuffer` and pass it as
`documentBuffer` instead of `document`.

## Use it in your own Vite app

```bash
npm install @eigenpal/docx-editor-react @eigenpal/docx-editor-core
```

The React adapter injects its own CSS. The toolbar icons need the Material
Symbols font, add this to `index.html`:

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
/>
```

Docs: https://www.docx-editor.dev/docs/1.x/react
