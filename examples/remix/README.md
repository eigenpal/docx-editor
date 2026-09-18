# Remix DOCX editor example

This Remix and Vite example loads the React DOCX editor after the route mounts. It shows the two separate problems server rendering causes, and renders a Word document with the packaged toolbar and a review pane.

## Run the example

From the repository root, build the workspace packages before you start Remix:

```bash
bun install
bun run build:packages
bun run dev:remix
```

Open `http://localhost:3001`.

## Set the client boundary

`app/routes/_index.tsx` uses a mount check and a lazy import. This is the shape of it, with the placeholder markup shortened:

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

The two work on different problems, and Remix needs both.

The mount check is about hydration. Remix renders the route on the server, and React compares that markup with the first client render. The editor produces different markup in the browser because it measures layout, so rendering it on both sides gives a hydration mismatch. Returning the same placeholder until `mounted` is true keeps the two renders identical.

The lazy import is about the server bundle. A static import pulls the editor into the server build, where its browser-only dependencies fail at module load, before any component renders. `lazy()` defers the import to the browser.

Remove the mount check and you get a hydration warning. Remove the lazy import and the server build fails to start.

## Match the fallback to the editor

React swaps the fallback for the editor in one frame. Give the fallback the height the editor will occupy, or the page moves when it mounts. Both placeholders in `_index.tsx` fill the viewport height for that reason.

## What the route renders

`app/components/Editor.tsx` renders `<DocxEditor>`, which supplies the title bar, menu, toolbar, and navigation pane. The `modules` prop registers comments, tracked changes, and suggesting mode, and `<DocxEditorReview />` mounts the review pane inside the editor.

## Add the editor to Remix

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Import `@docx-editor.dev/core/styles/editor.css` once. Render the editor only after the component mounts.

For more information, see the [Remix integration guide](https://www.docx-editor.dev/docs/2.x/frameworks/remix).
