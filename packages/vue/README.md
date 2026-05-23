<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-vue"><img src="https://img.shields.io/npm/v/@eigenpal/docx-editor-vue.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-vue"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-editor-vue.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

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

> **Using Nuxt?** [`@eigenpal/nuxt-docx-editor`](https://www.npmjs.com/package/@eigenpal/nuxt-docx-editor) wraps this adapter as a Nuxt 3 & 4 module — SSR-safe component registration and the stylesheet are wired automatically.

## Start with a blank document

Skip the file picker for new documents. `createEmptyDocument` returns a fresh `Document` model you can pass straight to the editor:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-editor-vue';
import '@eigenpal/docx-editor-vue/styles.css';

const doc = ref(createEmptyDocument());
// Or with options:
// createEmptyDocument({ initialText: 'Untitled', pageWidth: 12240 })
</script>

<template>
  <DocxEditor :document="doc" mode="editing" />
</template>
```

`createDocumentWithText(text, options?)` is the same idea with a starting paragraph already typed. Both helpers are re-exported from `@eigenpal/docx-editor-core` so you don't need a separate dependency.

## Packages

| Package                                                                                      | Description                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@eigenpal/docx-editor-react`](https://www.npmjs.com/package/@eigenpal/docx-editor-react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@eigenpal/docx-editor-vue`](https://www.npmjs.com/package/@eigenpal/docx-editor-vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@eigenpal/nuxt-docx-editor`](https://www.npmjs.com/package/@eigenpal/nuxt-docx-editor)     | <img src="https://cdn.simpleicons.org/nuxt/00DC82" width="20" align="middle" /> &nbsp; Nuxt 3 & 4 module wrapping this adapter.            |
| [`@eigenpal/docx-editor-core`](https://www.npmjs.com/package/@eigenpal/docx-editor-core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@eigenpal/docx-editor-i18n`](https://www.npmjs.com/package/@eigenpal/docx-editor-i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@eigenpal/docx-editor-agents`](https://www.npmjs.com/package/@eigenpal/docx-editor-agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

> **Forking the adapter?** Keep your fork thin. Depend on `@eigenpal/docx-editor-core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

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

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
