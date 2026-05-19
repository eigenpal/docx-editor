# @eigenpal/docx-editor-vue

Vue 3 adapter for the [docx-editor](https://docx-editor.dev). WYSIWYG `.docx` editing with canonical OOXML, tracked changes, comments, and an AI agent bridge.

## Quick Start

```bash
npm install @eigenpal/docx-editor-vue
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@eigenpal/docx-editor-vue';
import '@eigenpal/docx-editor-vue/styles.css';

const buffer = ref<ArrayBuffer | null>(null);

async function loadFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  buffer.value = file ? await file.arrayBuffer() : null;
}
</script>

<template>
  <input type="file" accept=".docx" @change="loadFile" />
  <DocxEditor v-if="buffer" :document-buffer="buffer" mode="editing" />
</template>
```

Import the stylesheet once at your app entry. Vite's library mode doesn't auto-inject CSS imports, so the toolbar will render unstyled without it.

## Imperative mounting

```ts
import { renderAsync } from '@eigenpal/docx-editor-vue';

const editor = await renderAsync(file, document.getElementById('editor')!, { mode: 'editing' });
await editor.save();
editor.destroy();
```

## Subpaths

- `@eigenpal/docx-editor-vue` — `DocxEditor`, `renderAsync`, public types
- `@eigenpal/docx-editor-vue/ui` — toolbar primitives, pickers, sidebars, dialogs
- `@eigenpal/docx-editor-vue/composables` — `useDocxEditor`, `useZoom`, `useTableSelection`, ...
- `@eigenpal/docx-editor-vue/dialogs` — dialog SFCs barrel
- `@eigenpal/docx-editor-vue/plugin-api` — plugin host and plugin-facing types
- `@eigenpal/docx-editor-vue/styles` — style constants (`EDITOR_CSS_PATH`, z-index)

## Component API

`DocxEditor` and `DocxEditorRef` mirror the React adapter — the same props, emits, and ref methods, with the import path swapped. Full reference: **[docx-editor.dev/docs/props](https://www.docx-editor.dev/docs/props)**.

For lower-level mounting on your own DOM, use the `useDocxEditor` composable.

## v1 scope

Real-time collaboration (Yjs), a third-party Vue plugin API, and a Nuxt module are deferred to a later 1.x release. If you need any of these today, prefer [`@eigenpal/docx-editor-react`](https://www.npmjs.com/package/@eigenpal/docx-editor-react).
