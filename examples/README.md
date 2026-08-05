# Examples

Runnable examples for every framework adapter. From the repo root:

```bash
# Vite + Vue together (the default dev target)
bun run dev

# Pick one
bun run dev:react   # examples/vite
bun run dev:igloo   # examples/igloo
bun run dev:vue     # examples/vue
bun run dev:nextjs  # examples/nextjs
bun run dev:nuxt    # examples/nuxt
bun run dev:remix   # examples/remix
bun run dev:astro   # examples/astro
```

## Catalogue

| Path                     | What it shows                                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite/`                  | Vanilla Vite + React. Default React dev target; point new contributors here first.                                                                                                                                                                 |
| `igloo/`                 | Deep customization (see [`docs/CUSTOMIZING.md`](../docs/CUSTOMIZING.md)): every `DocxEditor.*` part re-skinned, re-iconed and re-labelled under one theme, plus a host-composed context menu. Point people here who ask "how far can I take this?" |
| `vue/`                   | Vue 3 adapter, mirrors the Vite example.                                                                                                                                                                                                           |
| `nextjs/`                | Next.js App Router integration.                                                                                                                                                                                                                    |
| `nuxt/`                  | Nuxt 3/4 module (`@docx-editor.dev/nuxt`).                                                                                                                                                                                                         |
| `astro/`                 | Astro with React island.                                                                                                                                                                                                                           |
| `remix/`                 | Remix integration.                                                                                                                                                                                                                                 |
| `collaboration/`         | Real-time collab proof-of-concept.                                                                                                                                                                                                                 |
| `parity/`                | Single deployment serving React + Vue adapters with a switcher pill. Used by `bun run preview`.                                                                                                                                                    |
| `automation/`            | `@docx-editor.dev/editor-api` driving a document with no browser and no framework: a template filled from a script, plus what the browser subpath adds.                                                                                            |
| `plugins/hello-world/`   | Minimal plugin scaffold for `@docx-editor.dev/react`'s plugin API.                                                                                                                                                                                 |
| `plugins/docxtemplater/` | Plugin showing docxtemplater variable insertion with live preview.                                                                                                                                                                                 |
| `shared/`                | Shared switcher widgets + the demo `sample.docx`. Not a runnable example; imported by `vite/` and `vue/`.                                                                                                                                          |
| `dev-all.sh`             | Spins up several adapters at once for cross-adapter dogfooding. Backs `bun run dev:demo`.                                                                                                                                                          |

Adding a new example: drop it under `examples/<name>/`, add a row above, and if the example has its own `package.json` with dependencies, add its path to the root `package.json` `workspaces` list (skip for static/imported-only examples like `parity/` and `shared/`).
