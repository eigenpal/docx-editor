<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/v/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/react

React adapter for the [docx-editor](https://docx-editor.dev). WYSIWYG `.docx` editing with canonical OOXML, tracked changes, comments, real-time collaboration, and an AI agent bridge.

## Quick Start

```bash
npm install @docx-editor.dev/react
```

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

## Start with a blank document

Skip the file picker for new documents. `createEmptyDocument` returns a fresh `Document` model you can pass straight to the editor:

```tsx
import { DocxEditor, createEmptyDocument } from '@docx-editor.dev/react';
import '@docx-editor.dev/react/styles.css';

const doc = createEmptyDocument();
// Or with options:
// createEmptyDocument({ initialText: 'Untitled', pageWidth: 12240 })

<DocxEditor document={doc} mode="editing" />;
```

`createDocumentWithText(text, options?)` is the same idea with a starting paragraph already typed. Both helpers are re-exported from `@docx-editor.dev/core` so you don't need a separate dependency.

## Customize File > Open

By default, the built-in `File > Open` item and Cmd/Ctrl+O prompt for a `.docx` file and load it into the local editor view. Pass `onOpen` to keep the native file picker but route the selected `File` through your own import pipeline instead:

```tsx
<DocxEditor
  document={doc}
  externalContent
  externalPlugins={plugins}
  onOpen={async (file) => {
    await importIntoBackend(file);
  }}
/>
```

Set `showFileOpen={false}` to hide the built-in Open item and leave Cmd/Ctrl+O for your own menu or toolbar.

## Packages

| Package                                                                            | Description                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@docx-editor.dev/vue`](https://www.npmjs.com/package/@docx-editor.dev/vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@docx-editor.dev/agents`](https://www.npmjs.com/package/@docx-editor.dev/agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

> **Forking the adapter?** Keep your fork thin. Depend on `@docx-editor.dev/core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

## Imperative mounting

```ts
import { renderAsync } from '@docx-editor.dev/react';

const editor = await renderAsync(file, document.getElementById('editor')!, { mode: 'editing' });
await editor.save();
editor.destroy();
```

## Subpaths

- `@docx-editor.dev/react` — `DocxEditor`, `renderAsync`, public types
- `@docx-editor.dev/react/ui` — toolbar primitives, pickers, sidebars, dialogs
- `@docx-editor.dev/react/hooks` — `useAutoSave`, `useTableSelection`, ...
- `@docx-editor.dev/react/dialogs` — dialog components barrel
- `@docx-editor.dev/react/plugin-api` — plugin host and plugin-facing types
- `@docx-editor.dev/react/styles` — style constants (`EDITOR_CSS_PATH`, z-index)

## Plugins

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { PluginHost, templatePlugin } from '@docx-editor.dev/react/plugin-api';

<PluginHost plugins={[templatePlugin]}>
  <DocxEditor documentBuffer={buffer} />
</PluginHost>;
```

## Component API

Full props and ref reference: **[docx-editor.dev/docs/props](https://www.docx-editor.dev/docs/props)**. `DocxEditor` and `DocxEditorRef` mirror the Vue adapter, so docs apply with just the import path swapped.

`@docx-editor.dev/core` is installed transitively. Add it to your `package.json` only if your own code imports core APIs directly. Strict installers like pnpm with peer auto-install disabled may also need the ProseMirror peers listed in `package.json`.

Examples: [Vite](https://github.com/eigenpal/docx-editor/tree/main/examples/vite) · [Next.js](https://github.com/eigenpal/docx-editor/tree/main/examples/nextjs) · [Remix](https://github.com/eigenpal/docx-editor/tree/main/examples/remix) · [Astro](https://github.com/eigenpal/docx-editor/tree/main/examples/astro)

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
