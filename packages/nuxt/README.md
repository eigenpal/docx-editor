<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/nuxt"><img src="https://img.shields.io/npm/v/@docx-editor.dev/nuxt.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/nuxt"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/nuxt.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/nuxt

Nuxt 3 & 4 module for the [docx-editor](https://docx-editor.dev). Wraps [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue) and auto-imports an SSR-safe `<DocxEditor>` component — no manual import, no `<ClientOnly>` boilerplate.

## Quick Start

```bash
npm install @docx-editor.dev/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
});
```

```vue
<script setup lang="ts">
import { ref } from 'vue';

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

That's the whole integration. The module registers `<DocxEditor>` as **client-only** — the editor drives a hidden ProseMirror instance and browser DOM APIs, so it never runs during SSR. Nuxt renders a placeholder on the server and hydrates the editor in the browser. The module also pushes the editor stylesheet into Nuxt's CSS pipeline, so the toolbar is styled without a manual `import`.

## Options

```ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
  docxEditor: {
    prefix: 'Ep', // <EpDocxEditor> instead of <DocxEditor>
    injectStyles: true, // push @docx-editor.dev/vue/styles.css into nuxt.options.css
  },
});
```

| Option         | Type      | Default | Description                                                       |
| -------------- | --------- | ------- | ----------------------------------------------------------------- |
| `prefix`       | `string`  | `''`    | Component name prefix. `'Ep'` registers `<EpDocxEditor>`.         |
| `injectStyles` | `boolean` | `true`  | Set `false` to import `@docx-editor.dev/vue/styles.css` yourself. |

## Packages

| Package                                                                            | Description                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@docx-editor.dev/nuxt`](https://www.npmjs.com/package/@docx-editor.dev/nuxt)     | <img src="https://cdn.simpleicons.org/nuxt/00DC82" width="20" align="middle" /> &nbsp; Nuxt 3 & 4 module wrapping the Vue adapter.         |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@docx-editor.dev/agents`](https://www.npmjs.com/package/@docx-editor.dev/agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

## Component API

`<DocxEditor>` is the Vue adapter's component, registered unchanged — the same props, emits, and `DocxEditorRef` methods. Full reference: **[docx-editor.dev/docs/props](https://www.docx-editor.dev/docs/props)**.

## Composables

The Vue composables (`useDocxEditor`, `useZoom`, `useFindReplace`, `useAutoSave`, ...) are auto-imported — use them in any component or page without an `import`:

```vue
<script setup lang="ts">
const { save } = useAutoSave(/* ... */);
</script>
```

## Beyond the component

Other `@docx-editor.dev/vue` surfaces — `renderAsync`, `createEmptyDocument`, the `DocxEditorProps`/`DocxEditorRef` types, and the `/ui`, `/dialogs`, `/plugin-api` subpaths — are not re-exported by this module. Import them from the adapter directly, and add it to your own `dependencies` so the import is explicit:

```bash
npm install @docx-editor.dev/vue
```

```ts
import { renderAsync, createEmptyDocument } from '@docx-editor.dev/vue';
```

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
