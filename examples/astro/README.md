# Astro example

This example loads the React editor as an Astro island.

## Run the example

From the repository root, build the workspace packages before you start Astro:

```bash
bun install
bun run build:packages
bun run dev:astro
```

Open `http://localhost:4321`.

## Create the island

Use `client:only="react"` because the editor measures layout in the browser:

```astro
---
import { Editor } from '../components/Editor';
---
<Editor client:only="react" />
```

`client:load` still renders the component on the server.
That behavior fails when the editor accesses `window`.

## Add the editor to Astro

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
npx astro add react
```

Import `@docx-editor.dev/core/styles/editor.css` once.
Mount the editor with `client:only="react"`.

For more information, see the
[Astro integration guide](https://www.docx-editor.dev/docs/2.x/frameworks/astro).
