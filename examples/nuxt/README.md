# Nuxt example

`@eigenpal/nuxt-docx-editor`, the Nuxt 3 & 4 module wrapping the Vue adapter.
Registering the module is the whole integration: it auto-imports an
SSR-safe `<DocxEditor>` component and injects the editor stylesheet. No
manual import, no `<ClientOnly>` wrapper.

## Run it

From the repo root:

```bash
bun install
bun run dev:nuxt       # http://localhost:3002
```

Or from this directory: `bun run dev`.

## The integration

`nuxt.config.ts` is the entire setup:

```ts
export default defineNuxtConfig({
  modules: ['@eigenpal/nuxt-docx-editor'],
});
```

Then use `<DocxEditor>` anywhere. The module auto-imports it and registers it
client-only, so it never renders during SSR:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { createEmptyDocument } from '@eigenpal/docx-editor-core';

const doc = ref(createEmptyDocument());
</script>

<template>
  <DocxEditor :document="doc" :show-toolbar="true" />
</template>
```

## Files

| File             | What it does                                 |
| ---------------- | -------------------------------------------- |
| `nuxt.config.ts` | Registers the module, loads Material Symbols |
| `app.vue`        | Opens a `.docx` and renders `<DocxEditor>`   |

## Use it in your own Nuxt app

```bash
npm install @eigenpal/nuxt-docx-editor @eigenpal/docx-editor-core
```

Add the module to `nuxt.config.ts`. The module handles the client-only
boundary and the stylesheet. Load the Material Symbols font via
`app.head.link` in `nuxt.config.ts` for the toolbar icons.

Docs: https://www.docx-editor.dev/docs/1.x/vue/nuxt
