# Parity demo

Single deployment that serves the React and Vue adapter examples on the same domain. A switcher pill in each editor's toolbar flips between adapters with a normal page navigation. No iframes, no chrome wrapper — each adapter owns the full viewport.

## Why this exists

The 1.0.0 unification renames packages and ships React and Vue adapters from a shared `@eigenpal/docx-editor-core`. The community-trust signal is "the same DOCX renders identically in both adapters when installed from npm." This deployment proves it by serving both adapters from real `node_modules` resolution paths, not source aliases.

The build trick: dev mode aliases `@eigenpal/*` to `packages/*/src` for HMR. Parity mode sets `USE_PUBLISHED_PACKAGES=true` so vite resolves through `node_modules` → workspace `dist/` — the exact bytes a consumer downloads from npm.

## Routes

| Path      | Source               | Adapter                               |
| --------- | -------------------- | ------------------------------------- |
| `/`       | (vercel.json)        | 307 redirects to `/react/`            |
| `/react/` | `examples/vite/dist` | React (`@eigenpal/docx-editor-react`) |
| `/vue/`   | `examples/vue/dist`  | Vue (`@eigenpal/docx-editor-vue`)     |

The switcher pill in each editor's toolbar (`examples/shared/AdapterSwitcher.tsx` for React, inline HTML in Vue's `App.vue`) is just two anchor tags pointing at `/react/` and `/vue/`. Click is a normal navigation.

## Build

```bash
bun run build
```

Sequence:

1. Build all five workspace packages (`bun run build:packages`) so each has a `dist/`.
2. Build the React example with `USE_PUBLISHED_PACKAGES=true VITE_BASE_PATH=/react/` — vite skips workspace source aliases and resolves package names normally.
3. Build the Vue example with `USE_PUBLISHED_PACKAGES=true VITE_BASE_PATH=/vue/`.
4. Merge into `examples/parity/dist/{react,vue}/` and copy this folder's `index.html` to the root.

## Local preview

```bash
bun run preview
```

## Deploying to Vercel

Root `vercel.json` declares `bun run build` as the build, `examples/parity/dist` as the output, and the right SPA rewrites for `/react/*` and `/vue/*`. So any Vercel project pointed at this repo gets the parity preview by default — no dashboard overrides needed.

To stand up a preview for the `1.0.0-release` branch on a custom URL:

- In your Vercel project Settings → Domains, add a domain (e.g. `next.docx-editor.dev` or `1-0-0-release.docx-editor.dev`) and set its Git Branch to `1.0.0-release`. Every push to that branch redeploys.

The existing `latest.docx-editor.dev` deployment off `main` will pick up the parity build on its next deploy after this change merges. `/` redirects to `/react/`, the React adapter takes the full viewport, and a switcher pill in the toolbar flips to `/vue/`. A yellow banner on each editor route notes that this is a preview deployment and links back to `docx-editor.dev`.
