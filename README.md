<p align="center">
  <a href="https://github.com/eigenpal/docx-js-editor">
    <img src="./assets/logo.png" alt="DOCX JS Editor" width="600" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"><img src="https://img.shields.io/npm/v/@eigenpal/docx-js-editor.svg?style=flat-square&color=00C853" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-js-editor.svg?style=flat-square&color=00C853" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-js-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square&color=00C853" alt="license" /></a>
  <a href="https://docx-js-editor.vercel.app/"><img src="https://img.shields.io/badge/Live_Demo-00C853?style=flat-square&logo=vercel&logoColor=white" alt="Live Demo" /></a>
</p>

# @eigenpal/docx-js-editor

Open-source WYSIWYG DOCX editor for the browser. No server required. **[Live demo](https://docx-js-editor.vercel.app/)**

> **AI agents (Claude Code, Cursor, Copilot, etc.):** See the [full Agent Reference](https://raw.githubusercontent.com/eigenpal/docx-js-editor/main/AGENTS_README.md) for comprehensive API docs, code examples, and integration patterns.

<p align="center">
  <a href="https://docx-js-editor.vercel.app/">
    <img src="./assets/editor.png" alt="DOCX JS Editor screenshot" width="700" />
  </a>
</p>

- WYSIWYG editing with Word fidelity — formatting, tables, images, hyperlinks
- Track changes (suggestion mode) with accept/reject
- Comments with replies, resolve/reopen, scroll-to-highlight
- Plugin system, undo/redo, find & replace, print preview
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
  return <DocxEditor ref={editorRef} documentBuffer={file} onChange={() => {}} />;
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

See [docs/PLUGINS.md](docs/PLUGINS.md) for the full plugin API.

## Development

```bash
bun install
bun run dev        # localhost:5173
bun run build
bun run typecheck
```

Examples: [Vite](examples/vite) | [Next.js](examples/nextjs) | [Remix](examples/remix) | [Astro](examples/astro) | [Vue](examples/vue)

**[Props & Ref Methods](docs/PROPS.md)** | **[Plugins](docs/PLUGINS.md)** | **[Architecture](docs/ARCHITECTURE.md)**

## License

MIT
