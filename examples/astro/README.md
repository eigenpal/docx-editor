# Astro DOCX editor example

This example loads the React DOCX editor as an Astro island. It shows why the editor runs in the browser only, and renders a Word document with the packaged toolbar and a review pane.

## Run the example

From the repository root, build the workspace packages before you start Astro:

```bash
bun install
bun run build:packages
bun run dev:astro
```

Open `http://localhost:4321`.

## Create the island

Astro renders components on the server by default. The editor measures layout in the browser and reads `window`, so it must not run during the server render. Use `client:only="react"`:

```astro
---
import { Editor } from '../components/Editor';
---

<Editor client:only="react" />
```

`client:load` hydrates in the browser, but it still renders the component on the server first. That server render fails when the editor reads `window`. `client:only` skips it and mounts the component after the page loads.

## Reserve space for the island

Astro sends no HTML for a `client:only` island, so the page has an empty gap until React mounts. Give the island a height, or the rest of the page moves when the editor appears. In this example `src/components/Editor.tsx` sets its own root to the full viewport height, and the page body matches it.

## Load the stylesheet once

`src/pages/index.astro` imports `src/styles.css` in its frontmatter, and that file imports the editor stylesheet. The editor's styles are global, so import them once for the site rather than inside each island.

## What the island renders

`src/components/Editor.tsx` renders `<DocxEditor>`, which supplies the title bar, menu, toolbar, and navigation pane. Two props turn it into a review editor: `modules` registers comments, tracked changes, and suggesting mode, and `<DocxEditorReview />` mounts the review pane inside the editor. Remove both and the same document still opens, with revisions in their final state.

## Add the editor to an Astro site

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
npx astro add react
```

Mount the editor with `client:only="react"` and import the stylesheet once.

For more information, see the [Astro integration guide](https://www.docx-editor.dev/docs/2.x/frameworks/astro).
