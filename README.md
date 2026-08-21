<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="./.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/v/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

Open-source WYSIWYG `.docx` editor for React and Vue. Word-faithful pagination, tracked changes, comments — and **lossless round-trip**: untouched content and unsupported OOXML survive editing and save. **[Live demo](https://docx-editor.dev/editor)** | **[Documentation](https://www.docx-editor.dev/docs)**

## Quick Start

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core   # React
npm install @docx-editor.dev/vue @docx-editor.dev/core     # Vue
```

See the [React](#react) or [Vue](#vue) quick start below.

<p align="center">
  <a href="https://docx-editor.dev/editor">
    <img src="./.github/assets/editor.png" alt="docx-editor screenshot" width="100%" />
  </a>
</p>


## Packages

| Package                                                                                    | Description                                                                                                                                                                    | Docs                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)           | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Root component, provider primitives, shared hooks, and compound chrome. | [Docs](https://www.docx-editor.dev/docs/2.x/react)      |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue)               | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Root component, composition primitives, shared composables, and compound chrome.  | [Docs](https://www.docx-editor.dev/docs/2.x/vue)        |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)             | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint. Depend on this if you fork an adapter.                                             | [Docs](https://www.docx-editor.dev/docs/2.x/core)       |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)             | Shared locale strings and types consumed by the adapter.                                                                                                                       | [Docs](https://www.docx-editor.dev/docs/2.x/i18n)       |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro)               | Tracked changes, comments, and custom nodes.                                                                                                                                   | [Docs](https://www.docx-editor.dev/docs/2.x/pro)        |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Office.js-compatible editing API: a batching object model that edits a document from a server, or an editor already open in a page.                                            | [Docs](https://www.docx-editor.dev/docs/2.x/editor-api) |

Every package above is Apache 2.0 except `@docx-editor.dev/editor-api` and `@docx-editor.dev/pro`, which are licensed under the EigenPal Pro Evaluation License 1.0 ([editor-api](packages/editor-api/LICENSE.md), [pro](packages/pro/LICENSE.md)): free to evaluate, production use requires a commercial agreement — **[licensing@eigenpal.com](mailto:licensing@eigenpal.com)**.

> **Forking the adapter?** Keep your fork thin. Depend on `@docx-editor.dev/core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

## React

```tsx
import { useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import '@docx-editor.dev/core/styles/editor.css';

export function App() {
  const [doc, setDoc] = useState<Uint8Array>();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <input
        type="file"
        accept=".docx"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setDoc(file ? new Uint8Array(await file.arrayBuffer()) : undefined);
        }}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {doc && <DocxEditor document={doc} mode="edit" />}
      </div>
    </div>
  );
}
```

> **Next.js / SSR:** Use dynamic import. The editor requires the DOM.

Full docs: [`packages/react`](packages/react) · [API reference](https://www.docx-editor.dev/docs/2.x/react/props).

## Vue

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';

const doc = ref<Uint8Array>();

async function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  doc.value = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
}
</script>

<template>
  <div style="height: 100vh; display: flex; flex-direction: column">
    <input type="file" accept=".docx" @change="onPick" />
    <div style="flex: 1; min-height: 0">
      <DocxEditor v-if="doc" :document="doc" mode="edit" />
    </div>
  </div>
</template>
```

> **Nuxt / SSR:** Load the editor in a client-only component. The editor requires the DOM.

Full docs: [`packages/vue`](packages/vue) · [API reference](https://www.docx-editor.dev/docs/2.x/vue/props).

## Development

```bash
bun install
bun run dev        # localhost:5173
bun run build
bun run typecheck
```

A live preview of `main` is auto-deployed at **[latest.docx-editor.dev](https://latest.docx-editor.dev/)** — useful for trying out changes before they ship to npm.

Examples: [Vite](examples/vite) | [Next.js](examples/nextjs) | [Remix](examples/remix) | [Astro](examples/astro) | [Vue](examples/vue)

**[Documentation](https://www.docx-editor.dev/docs)** | **[React props & ref methods](https://www.docx-editor.dev/docs/2.x/react/props)** | **[Vue props & ref methods](https://www.docx-editor.dev/docs/2.x/vue/props)**

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Translations

| Locale  | Language             |
| ------- | -------------------- |
| `en`    | English              |
| `de`    | German               |
| `fr`    | French               |
| `he`    | Hebrew               |
| `hi`    | Hindi                |
| `id`    | Indonesian           |
| `pl`    | Polish               |
| `pt-BR` | Portuguese (Brazil)  |
| `tr`    | Turkish              |
| `zh-CN` | Chinese (Simplified) |

Help translate the editor into your language! See the full **[i18n contribution guide](docs/i18n.md)**.

```bash
bun run i18n:new de      # scaffold German locale
bun run i18n:status      # check translation coverage
```

## License

[Apache 2.0](LICENSE), except `packages/editor-api/` and `packages/pro/`, which are licensed under the EigenPal Pro Evaluation License 1.0 ([editor-api](packages/editor-api/LICENSE.md), [pro](packages/pro/LICENSE.md)). That licence permits internal, non-production evaluation; production use requires a written commercial agreement, available from **[licensing@eigenpal.com](mailto:licensing@eigenpal.com)**.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
