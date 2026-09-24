<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="./.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/v/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0_%2B_Pro-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

A visual `.docx` editor for React and Vue. Edit paginated Word documents in the browser and preserve untouched content and unsupported OOXML when saving. Comments and tracked changes require the EigenPal Pro License.

[Live demo](https://docx-editor.dev/editor) | [Documentation](https://www.docx-editor.dev/docs) | [Roadmap](https://github.com/orgs/eigenpal/projects/2)

## Quick start

Install the adapter for your framework and its required engine peer:

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core   # React
npm install @docx-editor.dev/vue @docx-editor.dev/core     # Vue
```

See the [React](#react) or [Vue](#vue) quick start.

For Node.js, use `^20.16.0 || >=22.3.0`. Browser applications can use the packages with their build tool.

<p align="center">
  <a href="https://docx-editor.dev/editor">
    <img src="./.github/assets/editor.png" alt="docx-editor screenshot" width="100%" />
  </a>
</p>

## Packages

| Package | Description | Docs |
| --- | --- | --- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react) | React editor components and hooks. | [React adapter](https://www.docx-editor.dev/docs/2.x/react) |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue) | Vue 3 editor components and composables. | [Vue adapter](https://www.docx-editor.dev/docs/2.x/vue) |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) | DOCX parsing, editing, and rendering. | [Core engine](https://www.docx-editor.dev/docs/2.x/core) |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n) | Translations and locale types. | [Translations](https://www.docx-editor.dev/docs/2.x/i18n) |
| [`@docx-editor.dev/fonts`](https://www.npmjs.com/package/@docx-editor.dev/fonts) | Open-licensed substitutes for Word fonts. | [Fonts and measurement](https://www.docx-editor.dev/docs/2.x/guides/fonts) |
| [`@docx-editor.dev/docx-to-markdown`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-markdown) | Convert DOCX to Markdown with page and image output. | [Markdown export](https://www.docx-editor.dev/docs/2.x/export/markdown) |
| [`@docx-editor.dev/docx-to-pdf`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-pdf) | Convert DOCX to PDF on Node.js. | [PDF export](https://www.docx-editor.dev/docs/2.x/export/pdf) |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro) | Tracked changes, comments, collaboration, and custom nodes. | [Review and collaboration](https://www.docx-editor.dev/docs/2.x/pro) |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | A supported subset of Word Office.js for browser and server editing. | [Document automation](https://www.docx-editor.dev/docs/2.x/editor-api) |

`@docx-editor.dev/editor-api`, `@docx-editor.dev/pro`, and `@docx-editor.dev/docx-to-pdf` use the EigenPal Pro License. See the license terms for [editor-api](packages/editor-api/LICENSE.md), [pro](packages/pro/LICENSE.md), and [docx-to-pdf](packages/docx-to-pdf/LICENSE.md). Compare license and support options on the [pricing page](https://www.docx-editor.dev/pricing).

## React

Import the stylesheet once and pass the selected file to the editor:

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

For Next.js and server-side rendering (SSR), use `dynamic(..., { ssr: false })` in a Client Component. The editor requires browser APIs.

Full docs: [React adapter](https://www.docx-editor.dev/docs/2.x/react) · [Props and ref methods](https://www.docx-editor.dev/docs/2.x/react/props).

## Vue

Import the stylesheet once and pass the selected file to the editor:

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

For Nuxt and server-side rendering, load the editor in a client-only component. The editor requires browser APIs.

Full docs: [Vue adapter](https://www.docx-editor.dev/docs/2.x/vue) · [Props and ref methods](https://www.docx-editor.dev/docs/2.x/vue/props).

## Customize the editor

Compare [toolbar designs](https://www.docx-editor.dev/docs/2.x/guides/toolbar#compare-toolbar-designs) and inspect their source. Use packaged controls, arrange toolbar parts, or build buttons with the shared command hooks.

Use the [document refresh API](https://www.docx-editor.dev/docs/2.x/guides/document-refresh) to display DOCX results from your server. Preserve scroll, highlight changes, and provide change navigation. The controller refuses results after local edits. Accepted files reset selection and undo history.

## Font measurement

Pass usable font bytes for Word-accurate line and page breaks. Without them, the editor uses fallback measurement that does not guarantee Word-compatible layout.

Use `packagedFonts()` from `@docx-editor.dev/fonts` for packaged substitutes. Use `customFonts()` from `@docx-editor.dev/core/editor` for your own font files. Add `googleFonts()` when your application accepts third-party font requests.

See [Fonts and measurement](https://www.docx-editor.dev/docs/2.x/guides/fonts).

## Development

Use the toolchain in [Contributing](CONTRIBUTING.md#prerequisites), then run these commands from the repository root:

```bash
bun install
bun run dev          # localhost:5173
bun run dev:markdown # Markdown demo: localhost:5177
bun run build
bun run typecheck
```

Try unreleased changes in the [preview of `main`](https://latest.docx-editor.dev/).

Examples: [Vite](examples/vite) | [DOCX to Markdown](examples/docx-to-markdown) | [DOCX to PDF](examples/docx-to-pdf) | [Next.js](examples/nextjs) | [Remix](examples/remix) | [Astro](examples/astro) | [Vue](examples/vue) | [Collaboration](examples/collaboration) | [Server agent review](examples/server-agent-review) | [Document refresh](examples/document-refresh)

[Documentation](https://www.docx-editor.dev/docs) | [React props and ref methods](https://www.docx-editor.dev/docs/2.x/react/props) | [Vue props and ref methods](https://www.docx-editor.dev/docs/2.x/vue/props)

## Contributing

See [Contributing](CONTRIBUTING.md) for setup, tests, and the Contributor License Agreement (CLA).

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

To add a locale, see the [i18n contribution guide](docs/i18n.md).

```bash
bun run i18n:new es      # Scaffold a Spanish locale.
bun run i18n:status      # check translation coverage
```

## License

The repository uses [Apache 2.0](LICENSE), with the package exceptions listed in [Packages](#packages). Bundled fonts retain their own licenses.

## Commercial support

For commercial support or custom features, [email the support team](mailto:docx-editor@eigenpal.com).

## Roadmap

See the [public roadmap](https://github.com/orgs/eigenpal/projects/2) for planned work and priorities.
