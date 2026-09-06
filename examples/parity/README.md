# Combined demo deployment

This site serves the React, Vue, Igloo, and DOCX-to-Markdown examples from one Vercel
deployment. Each app fills the viewport.

## Run locally

From the repository root, start the React and Vue development servers:

```bash
bun install
bun run dev
```

Open React at `http://localhost:5173/`.
Open Vue at `http://localhost:5174/`.

## Build the parity site

Build and preview the assembled site from the repository root:

```bash
bun run preview
```

Open one of these local URLs:

- `http://localhost:4173/react/`
- `http://localhost:4173/vue/`
- `http://localhost:4173/igloo/`
- `http://localhost:4173/docx-to-markdown/`

The local preview does not apply the root or hostname rewrites in `vercel.json`.

The build performs these steps:

1. It builds the seven demo workspace packages.
2. It builds the React and Vue adapters plus the Igloo and DOCX-to-Markdown apps.
3. It assigns `/react/`, `/vue/`, `/igloo/`, and `/docx-to-markdown/` as their base paths.
4. It assembles all four builds in `examples/parity/dist/`.

On Vercel, `/` rewrites to the React app. Hostname rewrites serve
`igloo.docx-editor.dev` from `/igloo/` and `docx-to-markdown.docx-editor.dev` from
`/docx-to-markdown/` without changing the browser URL. Before removing the old Igloo project, attach both custom domains to the same Vercel project.

## Adapter switcher

The React switcher is in `examples/shared/AdapterSwitcher.tsx`.
The Vue switcher is in `examples/vue/src/AdapterSwitcher.vue`.
The production links use `/react/` and `/vue/`.
