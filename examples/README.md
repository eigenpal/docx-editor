# Examples

Install dependencies from the repository root. Build the workspace packages before you run an
example that imports package output.

```bash
bun install
bun run build:packages
```

## Run an example

Use one root script for each development server:

```bash
bun run dev                 # React and Vue
bun run dev:react           # Vite and React
bun run dev:vue             # Vite and Vue
bun run dev:happypath       # Packaged React component
bun run dev:markdown        # Live DOCX editor + page-aware Markdown export
bun run dev:igloo           # Customized React interface
bun run dev:custom-nodes    # Custom content controls
bun run dev:nextjs          # Next.js
bun run dev:nuxt            # Nuxt; run build:packages:vue first
bun run dev:remix           # Remix
bun run dev:astro           # Astro
bun run dev:agent           # Document review agent
bun run dev:write-agent     # Document writing agent
bun run dev:collaboration   # Peer-to-peer collaboration
```

Set `OPENAI_API_KEY` as described in each agent example before you run `dev:agent` or
`dev:write-agent`.

Install Node 22.18 or later for the Hocuspocus server. Run the server and app in
separate terminals:

```bash
bun run dev:collaboration-hocuspocus:server
bun run dev:collaboration-hocuspocus
```

The Hocuspocus server uses `ws://127.0.0.1:1234`. The app uses
`http://localhost:5176`.

Run all main framework examples together:

```bash
bun run dev:demo
```

Build and serve the combined deployment preview:

```bash
bun run preview
```

Open `/react/`, `/vue/`, `/igloo/`, or `/docx-to-markdown/` on the printed local URL. The local
static server does not apply the hostname rewrites from `vercel.json`, so use these explicit paths.

Fill a DOCX template without a browser:

```bash
bun run --filter './examples/automation' fill
```

The React Vite example and the peer-to-peer collaboration example both use port `5173`.
Stop one server before you start the other.

## Catalog

- `vite/` shows the composed React API with Vite. It includes review features
  under the EigenPal Pro License and a custom citation node.
- `vue/` shows the Vue 3 adapter and mirrors the React example.
- `happy-path/` shows the packaged `<DocxEditor>` component with minimal host code.
- `docx-to-markdown/` shows live, page-aware Markdown beside an editable DOCX, including GFM
  tables and separate header/footer output.
- `igloo/` shows extensive interface customization. See
  [Customize the editor](../docs/CUSTOMIZING.md).
- `custom-nodes/` defines and edits a custom citation content control.
- `nextjs/` shows Next.js App Router integration.
- `nuxt/` shows the `@docx-editor.dev/nuxt` module.
- `remix/` shows Remix integration.
- `astro/` shows an Astro page with a React island.
- `agent/` uses an AI agent to read and comment on an open document.
- `write-agent/` uses an AI agent to create a document and propose tracked changes.
- `automation/` fills a DOCX template with `@docx-editor.dev/editor-api`.
- `collaboration/` uses `y-webrtc` for peer-to-peer collaboration without an application
  server.
- `collaboration-hocuspocus/` uses a Hocuspocus server for authenticated rooms and durable
  storage.
- `parity/` assembles the React, Vue, Igloo, and DOCX-to-Markdown builds for the primary Vercel
  deployment and `bun run preview`.
- `shared/` contains reusable example chrome, links, branding, and framework switchers. It is
  not runnable.
- `dev-all.sh` starts the main framework examples for `bun run dev:demo`.

When you add an example, add its path to this catalog. Add packages with dependencies to the
root `workspaces` list.
