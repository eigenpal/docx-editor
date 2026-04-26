<p align="center">
  <a href="https://github.com/eigenpal/docx-js-editor">
    <img src="./assets/logo.png" alt="DOCX JS Editor" width="600" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"><img src="https://img.shields.io/npm/v/@eigenpal/docx-js-editor.svg?style=flat-square&color=00C853" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-js-editor.svg?style=flat-square&color=00C853" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-js-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square&color=00C853" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-00C853?style=flat-square&logo=vercel&logoColor=white" alt="Live Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-00C853?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# docx-editor

Open-source WYSIWYG DOCX editor for the browser. No server required. **[Live demo](https://docx-editor.dev/editor)** | **[Documentation](https://www.docx-editor.dev/docs)**

<p align="center">
  <a href="https://docx-editor.dev/editor">
    <img src="./assets/editor.png" alt="DOCX JS Editor screenshot" width="700" />
  </a>
</p>

- WYSIWYG editing with Word fidelity — formatting, tables, images, hyperlinks
- Track changes (suggestion mode) with accept/reject
- Comments with replies, resolve/reopen, scroll-to-highlight
- Realtime collaboration with Yjs
- Internationalization (i18n) - [community-contributed translations welcome](docs/i18n.md#contributing-a-new-locale)
- Plugin system
- Client-side only, zero server dependencies

## Quick Start

```bash
npm install @eigenpal/docx-js-editor
```

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);
  return <DocxEditor ref={editorRef} documentBuffer={file} mode="editing" onChange={() => {}} />;
}
```

> **Next.js / SSR:** Use dynamic import — the editor requires the DOM.

## Packages

| Package                                      | Description                                                  |
| -------------------------------------------- | ------------------------------------------------------------ |
| [`@eigenpal/docx-js-editor`](packages/react) | React UI — toolbar, paged editor, plugins. **Install this.** |
| [`@eigenpal/docx-editor-vue`](packages/vue)  | Vue.js scaffold — contributions welcome                      |

## Plugins

```tsx
import { DocxEditor, PluginHost, templatePlugin } from '@eigenpal/docx-js-editor';

<PluginHost plugins={[templatePlugin]}>
  <DocxEditor documentBuffer={file} />
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

Examples: [Vite](examples/vite) | [Next.js](examples/nextjs) | [Remix](examples/remix) | [Astro](examples/astro) | [Vue](examples/vue)

**[Documentation](https://www.docx-editor.dev/docs)** | **[Props & Ref Methods](https://www.docx-editor.dev/docs/props)** | **[Plugins](https://www.docx-editor.dev/docs/plugins)** | **[Architecture](https://www.docx-editor.dev/docs/architecture)**

## Translations

Help translate the editor into your language! See the full **[i18n contribution guide](docs/i18n.md)**.

```bash
bun run i18n:new de      # scaffold German locale
bun run i18n:status      # check translation coverage
```

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
