# Vue example

`@docx-editor.dev/vue` in a plain Vue 3 + Vite SPA. Same editor and same
surface as the React adapter, with Vue components and refs. No SSR, so the
editor mounts directly.

## Run it

From the repo root:

```bash
bun install
bun run dev:vue        # http://localhost:5174
```

Or from this directory: `bun run dev`.

## Files

| File             | What it does                                            |
| ---------------- | ------------------------------------------------------- |
| `src/App.vue`    | The editor: open `.docx`, edit, agent panel             |
| `src/main.ts`    | Vue app root + `@docx-editor.dev/vue/styles.css`        |
| `index.html`     | Page shell, icons, and share tags                       |
| `vite.config.ts` | Aliases `@docx-editor.dev/*` to workspace source in dev |

## Minimal integration

```vue
<script setup lang="ts">
import { DocxEditor } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';
import { createEmptyDocument } from '@docx-editor.dev/core';

const doc = createEmptyDocument();
</script>

<template>
  <DocxEditor :document="doc" :show-toolbar="true" />
</template>
```

To open a real file, read it as an `ArrayBuffer` and pass it as
`:document-buffer` instead of `:document`.

## Use it in your own Vue app

```bash
npm install @docx-editor.dev/vue @docx-editor.dev/core
```

Unlike the React adapter, the Vue adapter ships a stylesheet you must import
once: `@docx-editor.dev/vue/styles.css`. Toolbar icons are bundled as inline
SVG, so there is no icon font to load.

Docs: https://www.docx-editor.dev/docs/1.x/vue
