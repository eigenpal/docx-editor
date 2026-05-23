<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-react"><img src="https://img.shields.io/npm/v/@eigenpal/docx-editor-react.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-react"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-editor-react.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @eigenpal/docx-editor-react

React adapter for the [docx-editor](https://docx-editor.dev). WYSIWYG `.docx` editing with canonical OOXML, tracked changes, comments, real-time collaboration, and an AI agent bridge.

## Quick Start

```bash
npm install @eigenpal/docx-editor-react
```

```tsx
import { useState } from 'react';
import { DocxEditor } from '@eigenpal/docx-editor-react';
import '@eigenpal/docx-editor-react/styles.css';

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

## Start with a blank document

Skip the file picker for new documents. `createEmptyDocument` returns a fresh `Document` model you can pass straight to the editor:

```tsx
import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-editor-react';
import '@eigenpal/docx-editor-react/styles.css';

const doc = createEmptyDocument();
// Or with options:
// createEmptyDocument({ initialText: 'Untitled', pageWidth: 12240 })

<DocxEditor document={doc} mode="editing" />;
```

`createDocumentWithText(text, options?)` is the same idea with a starting paragraph already typed. Both helpers are re-exported from `@eigenpal/docx-editor-core` so you don't need a separate dependency.

## Packages

| Package                                                                                      | Description                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@eigenpal/docx-editor-react`](https://www.npmjs.com/package/@eigenpal/docx-editor-react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@eigenpal/docx-editor-vue`](https://www.npmjs.com/package/@eigenpal/docx-editor-vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@eigenpal/docx-editor-core`](https://www.npmjs.com/package/@eigenpal/docx-editor-core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@eigenpal/docx-editor-i18n`](https://www.npmjs.com/package/@eigenpal/docx-editor-i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@eigenpal/docx-editor-agents`](https://www.npmjs.com/package/@eigenpal/docx-editor-agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

> **Forking the adapter?** Keep your fork thin. Depend on `@eigenpal/docx-editor-core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

## Imperative mounting

```ts
import { renderAsync } from '@eigenpal/docx-editor-react';

const editor = await renderAsync(file, document.getElementById('editor')!, { mode: 'editing' });
await editor.save();
editor.destroy();
```

## Subpaths

- `@eigenpal/docx-editor-react` — `DocxEditor`, `renderAsync`, public types
- `@eigenpal/docx-editor-react/ui` — toolbar primitives, pickers, sidebars, dialogs
- `@eigenpal/docx-editor-react/hooks` — `useAutoSave`, `useTableSelection`, ...
- `@eigenpal/docx-editor-react/dialogs` — dialog components barrel
- `@eigenpal/docx-editor-react/plugin-api` — plugin host and plugin-facing types
- `@eigenpal/docx-editor-react/styles` — style constants (`EDITOR_CSS_PATH`, z-index)

## Plugins

```tsx
import { DocxEditor } from '@eigenpal/docx-editor-react';
import { PluginHost, templatePlugin } from '@eigenpal/docx-editor-react/plugin-api';

<PluginHost plugins={[templatePlugin]}>
  <DocxEditor documentBuffer={buffer} />
</PluginHost>;
```

## Component API

Full props and ref reference: **[docx-editor.dev/docs/props](https://www.docx-editor.dev/docs/props)**. `DocxEditor` and `DocxEditorRef` mirror the Vue adapter, so docs apply with just the import path swapped.

`@eigenpal/docx-editor-core` is installed transitively. Add it to your `package.json` only if your own code imports core APIs directly. Strict installers like pnpm with peer auto-install disabled may also need the ProseMirror peers listed in `package.json`.

Examples: [Vite](https://github.com/eigenpal/docx-editor/tree/main/examples/vite) · [Next.js](https://github.com/eigenpal/docx-editor/tree/main/examples/nextjs) · [Remix](https://github.com/eigenpal/docx-editor/tree/main/examples/remix) · [Astro](https://github.com/eigenpal/docx-editor/tree/main/examples/astro)

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
