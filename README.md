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

| Package                                      | Description                                                      |
| -------------------------------------------- | ---------------------------------------------------------------- |
| [`@eigenpal/docx-js-editor`](packages/react) | React UI — toolbar, paged editor, plugins. **Install this one.** |
| [`@eigenpal/docx-core`](packages/core)       | Framework-agnostic core — parsing, ProseMirror, layout engine    |
| [`@eigenpal/docx-editor-vue`](packages/vue)  | Vue.js scaffold — contributions welcome                          |

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

<details>
<summary>Props & Ref Methods</summary>

### Props

| Prop             | Type                                        | Default  | Description                                 |
| ---------------- | ------------------------------------------- | -------- | ------------------------------------------- |
| `documentBuffer` | `ArrayBuffer \| Uint8Array \| Blob \| File` | —        | `.docx` file contents                       |
| `document`       | `Document`                                  | —        | Pre-parsed document (alternative to buffer) |
| `author`         | `string`                                    | `'User'` | Author name for comments and track changes  |
| `readOnly`       | `boolean`                                   | `false`  | Read-only preview                           |
| `showToolbar`    | `boolean`                                   | `true`   | Show formatting toolbar                     |
| `showRuler`      | `boolean`                                   | `false`  | Show rulers                                 |
| `initialZoom`    | `number`                                    | `1.0`    | Initial zoom level                          |
| `theme`          | `Theme \| null`                             | —        | Theme                                       |
| `toolbarExtra`   | `ReactNode`                                 | —        | Custom toolbar items                        |
| `placeholder`    | `ReactNode`                                 | —        | Placeholder when no doc loaded              |
| `onChange`       | `(doc: Document) => void`                   | —        | Document change callback                    |
| `onSave`         | `(buffer: ArrayBuffer) => void`             | —        | Save callback                               |
| `onError`        | `(error: Error) => void`                    | —        | Error callback                              |

Full list: [`DocxEditorProps`](packages/react/src/components/DocxEditor.tsx)

### Ref Methods

```tsx
await ref.current.save(); // → ArrayBuffer
ref.current.getDocument(); // → Document
ref.current.setZoom(1.5);
ref.current.focus();
ref.current.scrollToPage(3);
ref.current.print();
```

</details>

## License

MIT
