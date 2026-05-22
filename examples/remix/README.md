# Remix example

`@eigenpal/docx-editor-react` in Remix (Vite). Remix renders on the server by
default, and the editor is browser-only, so the route gates it behind a
mount check and a `lazy()` import.

## Run it

This example resolves the `@eigenpal/*` packages from their built output, so
build the workspace packages once first. From the repo root:

```bash
bun install
bun run build:packages
bun run dev:remix      # http://localhost:3001
```

Or from this directory: `bun run dev`.

## The SSR boundary

`app/routes/_index.tsx` renders a loading state on the server and the first
client paint, then swaps in the editor after mount:

```tsx
import { lazy, Suspense, useEffect, useState } from 'react';

const Editor = lazy(() => import('../components/Editor').then((m) => ({ default: m.Editor })));

export default function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div>Loading editor...</div>;
  return (
    <Suspense fallback={<div>Loading editor...</div>}>
      <Editor />
    </Suspense>
  );
}
```

The `mounted` guard keeps the server and first-render markup identical so
hydration does not mismatch. `lazy()` keeps the editor bundle out of the
server build.

## Files

| File                        | What it does                               |
| --------------------------- | ------------------------------------------ |
| `app/routes/_index.tsx`     | Mount guard + lazy editor import           |
| `app/components/Editor.tsx` | `<DocxEditor />` and file handling         |
| `app/root.tsx`              | Loads the Material Symbols font            |
| `vite.config.ts`            | Remix Vite plugin + Tailwind/PostCSS setup |

## Use it in your own Remix app

```bash
npm install @eigenpal/docx-editor-react @eigenpal/docx-editor-core
```

Render the editor only after mount (the `useState`/`useEffect` pattern
above) or it will crash server rendering on `window`. Load the Material
Symbols font in `app/root.tsx`.

Docs: https://www.docx-editor.dev/docs/1.x/react
