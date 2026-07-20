# Docxtemplater Plugin

Adds [docxtemplater](https://docxtemplater.com) syntax support to the DOCX editor. Detects template tags in the document, highlights them, and lists them in the unified sidebar.

## Features

- Detects variables (`{name}`), loops (`{#items}...{/items}`), and conditionals (`{#show}...{/show}`)
- Color-coded highlighting by tag type
- Unified-sidebar chips showing the template structure
- Click-to-navigate from a chip to its tag in the document

## Architecture

This feature spans two plugin systems:

```
EditorPlugin (this directory)           CorePlugin (packages/core/src/core-plugins/docxtemplater/)
├── ProseMirror plugin                  ├── Command handlers
│   ├── Scans doc for {tags}            │   ├── insertTemplateVariable
│   ├── Creates DecorationSet           │   └── replaceWithTemplateVariable
│   └── Updates on every transaction    └── Headless document manipulation
├── Overlay renderer
│   └── Highlights tags over visible
│       pages using RenderedDomContext
└── Sidebar item provider
    └── Renders template chips, click-to-navigate
```

- **EditorPlugin** handles everything visual: the ProseMirror plugin scans the document for `{...}` patterns on every transaction, builds a `DecorationSet`, and the overlay renderer uses `RenderedDomContext` to position highlights over the visible pages.
- **CorePlugin** handles headless operations: command handlers that `DocumentAgent` dispatches to for server-side template manipulation (API routes, scripts).

Both share the same `Document` model — they don't depend on each other directly.

## Usage

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { PluginHost, templatePlugin } from '@docx-editor.dev/react/plugin-api';
import '@docx-editor.dev/react/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[templatePlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

## Template Processing

To fill a template with data (outside the editor):

```tsx
import { processTemplate } from '@docx-editor.dev/core/headless';

const filled = await processTemplate(docxBuffer, {
  name: 'Jane Doe',
  company: 'Acme Inc.',
});
// filled is an ArrayBuffer of the populated .docx
```
