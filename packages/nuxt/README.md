<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/nuxt

This private workspace package provides a Nuxt 3 and 4 module for [docx-editor.dev](https://docx-editor.dev). npm does not publish it.

External Nuxt applications can use `@docx-editor.dev/vue` inside `<ClientOnly>`. See the [Nuxt guide](https://www.docx-editor.dev/docs/2.x/frameworks/nuxt).

## Workspace setup

Register the private module in `nuxt.config.ts`:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
});
```

Use the registered component to open a selected file:

```vue
<script setup lang="ts">
import { ref } from 'vue';

const doc = ref<Uint8Array>();

async function loadFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  doc.value = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
}
</script>

<template>
  <input type="file" accept=".docx" @change="loadFile" />
  <DocxEditor v-if="doc" :document="doc" mode="edit" />
</template>
```

The module registers `<DocxEditor>` as a client-only component. Nuxt renders a server placeholder and hydrates the editor in the browser.

The module also adds the editor stylesheet to the Nuxt CSS pipeline.

## Options

Set the component prefix and stylesheet behavior in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
  docxEditor: {
    prefix: 'Ep', // <EpDocxEditor> instead of <DocxEditor>
    injectStyles: true, // push @docx-editor.dev/vue/styles.css into nuxt.options.css
  },
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `prefix` | `string` | `''` | Component name prefix. `'Ep'` registers `<EpDocxEditor>`. |
| `injectStyles` | `boolean` | `true` | Set `false` to import `@docx-editor.dev/vue/styles.css` yourself. |

## Packages

| Package | Description |
| --- | --- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react) | React adapter with packaged chrome. |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue) | Vue 3 adapter with packaged chrome. |
| `@docx-editor.dev/nuxt` | Private Nuxt 3 and 4 workspace module. |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint. Depend on this if you fork the React or Vue adapter. |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n) | Shared locale strings and types consumed by both adapters. |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Document automation: a batching object model that drives a document from a server or from an editor already open in a page. |

## Component API

`<DocxEditor>` is the Vue adapter component. It keeps the same props, emits, and `DocxEditorRef` methods. See the [Vue props reference](https://www.docx-editor.dev/docs/2.x/vue/props).

## Beyond the component

When you need the rest of the Vue adapter surface, import it from `@docx-editor.dev/vue` directly:

- the `DocxEditorProps` and `DocxEditorRef` types
- composition primitives like `DocxEditorRoot`, `DocxEditorToolbar`, `DocxEditorNavigation`, `HorizontalRuler`, and `PageIndicator`

These are not re-exported by the Nuxt module. Import them from the adapter directly, and add it to your own `dependencies` so the import is explicit:

```bash
npm install @docx-editor.dev/vue @docx-editor.dev/core
```

## Contributing

To contribute, see [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial support

For commercial support or custom features, [email the support team](mailto:docx-editor@eigenpal.com).
