# Next.js DOCX editor example

This App Router example loads the React DOCX editor in the browser. It shows where the client boundary goes in an App Router tree, and renders a Word document with the packaged toolbar and a review pane.

## Run the example

From the repository root, build the workspace packages before you start Next.js:

```bash
bun install
bun run build:packages
bun run dev:nextjs
```

Open `http://localhost:3000`.

## Set the client boundary

`app/page.tsx` is a Client Component that loads the editor with `dynamic()`:

```tsx
'use client';

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./components/Editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => <div>Loading editor...</div>,
});

export default function Page() {
  return <Editor />;
}
```

Two details in that call matter.

`ssr: false` keeps the editor out of the server render. The editor measures layout and reads `window`, so a server render either fails or produces markup that does not match the browser.

The `'use client'` directive is required for this file. The App Router rejects `dynamic()` with `ssr: false` inside a Server Component, and the error names the file rather than the call, which is easy to misread as a problem in the editor.

`app/components/Editor.tsx` also declares `'use client'`, because it holds state.

## Reserve space while the editor loads

The `loading` option renders until the editor chunk arrives. Give it the height the editor will occupy. Without it the page is empty and then jumps, which counts against Cumulative Layout Shift on a route where the editor is the main content.

## Where the stylesheet loads

`app/globals.css` imports the editor stylesheet, and `app/layout.tsx` loads that file once for the whole app. The editor's styles are global, so they belong in one import rather than in each component that renders an editor.

## What the page renders

`app/components/Editor.tsx` renders `<DocxEditor>`, which supplies the title bar, menu, toolbar, and navigation pane. The `modules` prop registers comments, tracked changes, and suggesting mode, and `<DocxEditorReview />` mounts the review pane inside the editor.

## Add the editor to Next.js

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Load your editor component with `dynamic(..., { ssr: false })` from a Client Component.

For more information, see the [React adapter guide](https://www.docx-editor.dev/docs/2.x/react).
