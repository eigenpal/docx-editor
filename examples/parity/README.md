# Parity demo

This demo serves the React and Vue examples from one origin.
Each adapter owns the full viewport without an iframe or shared wrapper.

## Run source development

From the repository root, run both source-based development servers:

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

Open `http://localhost:4173/react/` or `http://localhost:4173/vue/`.

The build performs these steps:

1. It builds the six demo workspace packages.
2. It builds both adapters from workspace `dist/` output.
3. It sets `/react/` and `/vue/` as the respective base paths.
4. It assembles both builds in `examples/parity/dist/`.

The root path redirects to `/react/`.

## Adapter switcher

The React switcher is in `examples/shared/AdapterSwitcher.tsx`.
The Vue switcher is in `examples/vue/src/AdapterSwitcher.vue`.
The production links use `/react/` and `/vue/`.
