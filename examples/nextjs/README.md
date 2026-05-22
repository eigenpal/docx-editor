# Next.js example

`@eigenpal/docx-editor-react` in the Next.js App Router. The editor reads
the DOM and measures layout in the browser, so it cannot run during server
rendering. The fix is one `dynamic()` import with `ssr: false`.

## Run it

This example depends on the `@eigenpal/*` workspace packages, so build them
once first. From the repo root:

```bash
bun install
bun run build:packages
bun run dev:nextjs     # http://localhost:3000
```

Or from this directory: `bun run dev`.

## The SSR boundary

`app/page.tsx` keeps the route a Server Component shell and pulls the editor
in client-only:

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

`app/components/Editor.tsx` is a `'use client'` component that renders
`<DocxEditor />`. Without `ssr: false` the build fails on `window`/`document`
access during prerender.

## Files

| File                        | What it does                             |
| --------------------------- | ---------------------------------------- |
| `app/page.tsx`              | Server shell, client-only editor import  |
| `app/components/Editor.tsx` | `'use client'` editor component          |
| `app/layout.tsx`            | Loads the Material Symbols font          |
| `next.config.ts`            | Monorepo file tracing + build-time flags |

## Use it in your own Next.js app

```bash
npm install @eigenpal/docx-editor-react @eigenpal/docx-editor-core
```

Always import `DocxEditor` through `dynamic(..., { ssr: false })`, or wrap it
in a `'use client'` component that only renders after mount. Load the
Material Symbols font in `app/layout.tsx`.

Docs: https://www.docx-editor.dev/docs/1.x/react
