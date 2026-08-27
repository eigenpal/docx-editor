# Remix example

This Remix and Vite example loads the React editor after the route mounts.

## Run the example

From the repository root, build the workspace packages before you start Remix:

```bash
bun install
bun run build:packages
bun run dev:remix
```

Open `http://localhost:3001`.

## Set the client boundary

`app/routes/_index.tsx` uses a mount check and a lazy import:

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

The mount check keeps the server markup and first client markup identical.
The lazy import keeps the editor out of the server build.

## Add the editor to Remix

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Import `@docx-editor.dev/core/styles/editor.css` once.
Render the editor only after the component mounts.

For more information, see the
[Remix integration guide](https://www.docx-editor.dev/docs/2.x/frameworks/remix).
