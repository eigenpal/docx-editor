# Vite example

`@docx-editor.dev/react` in a plain Vite + React SPA. No SSR, so the
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

| File             | What it does                                            |
| ---------------- | ------------------------------------------------------- |
| `src/App.tsx`    | The editor: open `.docx`, edit, render an agent panel   |
| `src/main.tsx`   | React root + `styles.css`                               |
| `index.html`     | Page shell, icons, and share tags                       |
| `vite.config.ts` | Aliases `@docx-editor.dev/*` to workspace source in dev |

## Minimal integration

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { createEmptyDocument } from '@docx-editor.dev/core';

export default function App() {
  return <DocxEditor document={createEmptyDocument()} showToolbar />;
}
```

To open a real file, read it as an `ArrayBuffer` and pass it as
`documentBuffer` instead of `document`.

## Use it in your own Vite app

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

The React adapter injects its own CSS. Toolbar icons are bundled as inline
SVG, so there is no icon font to load.

Docs: https://www.docx-editor.dev/docs/1.x/react
