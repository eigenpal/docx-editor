<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="./.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/v/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-js-editor.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

Open-source WYSIWYG `.docx` editor for React and Vue with canonical OOXML, tracked changes, and real-time collaboration. Agent-ready. **[Live demo](https://docx-editor.dev/editor)** | **[Documentation](https://www.docx-editor.dev/docs)**

## Quick Start

```bash
npm install @docx-editor.dev/react
```

See the [React quick start](#react) below.

```bash
npm install @docx-editor.dev/vue
```

See the [Vue quick start](#vue) below.

```bash
npm install @docx-editor.dev/nuxt
```

See the [Nuxt quick start](#nuxt) below.

<p align="center">
  <a href="https://docx-editor.dev/editor">
    <img src="./.github/assets/editor.png" alt="docx-editor screenshot" width="100%" />
  </a>
</p>

## Packages

| Package                                                                            | Description                                                                                                                                | Docs                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     | [Docs](https://www.docx-editor.dev/docs/1.x/react)    |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  | [Docs](https://www.docx-editor.dev/docs/1.x/vue)      |
| [`@docx-editor.dev/nuxt`](https://www.npmjs.com/package/@docx-editor.dev/nuxt)     | <img src="https://cdn.simpleicons.org/nuxt/00DC82" width="20" align="middle" /> &nbsp; Nuxt 3 & 4 module wrapping the Vue adapter.         | [Docs](https://www.docx-editor.dev/docs/1.x/vue/nuxt) |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. | [Docs](https://www.docx-editor.dev/docs/1.x/core)     |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 | [Docs](https://www.docx-editor.dev/docs/1.x/i18n)     |
| [`@docx-editor.dev/agents`](https://www.npmjs.com/package/@docx-editor.dev/agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus UI components.                                         | [Docs](https://www.docx-editor.dev/docs/1.x/agents)   |

> **Forking the adapter?** Keep your fork thin. Depend on `@docx-editor.dev/core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

## React

```tsx
import { useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import '@docx-editor.dev/react/styles.css';

export function App() {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);

  return (
    <>
      <input
        type="file"
        accept=".docx"
        onChange={async (e) => setBuffer((await e.target.files?.[0]?.arrayBuffer()) ?? null)}
      />
      {buffer && <DocxEditor documentBuffer={buffer} mode="editing" />}
    </>
  );
}
```

> **Next.js / SSR:** Use dynamic import. The editor requires the DOM.

Full docs: [`packages/react`](packages/react) · [API reference](https://www.docx-editor.dev/docs/props).

## Vue

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@docx-editor.dev/vue';
import '@docx-editor.dev/vue/styles.css';

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

Full docs: [`packages/vue`](packages/vue) · [API reference](https://www.docx-editor.dev/docs/props).

## Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@docx-editor.dev/nuxt'],
});
```

`@docx-editor.dev/nuxt` wraps the Vue adapter as a Nuxt 3 & 4 module: it auto-imports an SSR-safe `<DocxEditor>` component (no manual import, no `<ClientOnly>` wrapper) and the Vue composables.

Full docs: [`packages/nuxt`](packages/nuxt).

## Plugins

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { PluginHost, templatePlugin } from '@docx-editor.dev/react/plugin-api';

<PluginHost plugins={[templatePlugin]}>
  <DocxEditor documentBuffer={buffer} />
</PluginHost>;
```

See the [plugin documentation](https://www.docx-editor.dev/docs/plugins) for the full plugin API.

## Development

```bash
bun install
bun run dev        # localhost:5173
bun run build
bun run typecheck
```

A live preview of `main` is auto-deployed at **[latest.docx-editor.dev](https://latest.docx-editor.dev/)** — useful for trying out changes before they ship to npm.

Examples: [Vite](examples/vite) | [Next.js](examples/nextjs) | [Remix](examples/remix) | [Astro](examples/astro) | [Vue](examples/vue) | [Nuxt](examples/nuxt)

**[Documentation](https://www.docx-editor.dev/docs)** | **[Props & Ref Methods](https://www.docx-editor.dev/docs/props)** | **[Plugins](https://www.docx-editor.dev/docs/plugins)** | **[Architecture](https://www.docx-editor.dev/docs/architecture)**

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
| `pl`    | Polish               |
| `pt-BR` | Portuguese (Brazil)  |
| `tr`    | Turkish              |
| `zh-CN` | Chinese (Simplified) |

Help translate the editor into your language! See the full **[i18n contribution guide](docs/i18n.md)**.

```bash
bun run i18n:new de      # scaffold German locale
bun run i18n:status      # check translation coverage
```

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
