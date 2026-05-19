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
