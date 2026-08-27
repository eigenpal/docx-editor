# Next.js example

This App Router example loads the React editor in the browser.

## Run the example

From the repository root, build the workspace packages before you start Next.js:

```bash
bun install
bun run build:packages
bun run dev:nextjs
```

Open `http://localhost:3000`.

## Set the client boundary

`app/page.tsx` is a Client Component. It uses `dynamic()` with `ssr: false`:

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

Next.js requires the `dynamic()` call inside a Client Component.
`app/components/Editor.tsx` also uses `'use client'` and renders `<DocxEditor />`.

## Add the editor to Next.js

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Import `@docx-editor.dev/core/styles/editor.css` once.
Load your editor component with `dynamic(..., { ssr: false })`.

For more information, see the
[React adapter guide](https://www.docx-editor.dev/docs/2.x/react).
