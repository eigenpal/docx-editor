# Astro example

`@docx-editor.dev/react` as an Astro island. Astro ships zero JS by
default. The editor is interactive and browser-only, so it loads with the
`client:only` directive, which skips SSR for that component entirely.

## Run it

This example resolves the `@docx-editor.dev/*` packages from their built output, so
build the workspace packages once first. From the repo root:

```bash
bun install
bun run build:packages
bun run dev:astro      # http://localhost:4321
```

Or from this directory: `bun run dev`.

## The island

`src/pages/index.astro` renders the React editor as a client-only island:

```astro
---
import { Editor } from '../components/Editor';
---
<Editor client:only="react" />
```

`client:only="react"` is the key: `client:load` would still server-render the
component first and crash on `window`. `client:only` renders it in the
browser only. The page shell, fonts, and styles are still static HTML.

## Files

| File                        | What it does                            |
| --------------------------- | --------------------------------------- |
| `src/pages/index.astro`     | Page shell + the `client:only` island   |
| `src/components/Editor.tsx` | React `<DocxEditor />` component        |
| `astro.config.mjs`          | `@astrojs/react` integration + Tailwind |

## Use it in your own Astro app

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
npx astro add react
```

Always mount the editor with `client:only="react"`. Toolbar icons are
bundled as inline SVG, so there is no icon font to load.

Docs: https://www.docx-editor.dev/docs/1.x/react
