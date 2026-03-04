# Docxtemplater Plugin

Adds [docxtemplater](https://docxtemplater.com) syntax support to the DOCX editor. Detects template tags in the document and provides visual highlighting and a schema annotation panel.

## Features

- Detects variables (`{name}`), loops (`{#items}...{/items}`), and conditionals (`{#show}...{/show}`)
- Color-coded highlighting by tag type
- Side panel showing the full template structure
- Click-to-navigate from panel to tag in the document

## Architecture

This feature spans two plugin systems:

```
EditorPlugin (this directory)           CorePlugin (src/core-plugins/docxtemplater/)
├── ProseMirror plugin                  ├── Command handlers
│   ├── Scans doc for {tags}            │   ├── insertTemplateVariable
│   ├── Creates DecorationSet           │   └── replaceWithTemplateVariable
│   └── Updates on every transaction    └── Headless document manipulation
├── Overlay renderer
│   └── Highlights tags over visible
│       pages using RenderedDomContext
└── AnnotationPanel
    └── Lists tags, click-to-navigate
```

- **EditorPlugin** handles everything visual: the ProseMirror plugin scans the document for `{...}` patterns on every transaction, builds a `DecorationSet`, and the overlay renderer uses `RenderedDomContext` to position highlights over the visible pages.
- **CorePlugin** handles headless operations: command handlers that `DocumentAgent` dispatches to for server-side template manipulation (API routes, scripts).

Both share the same `Document` model — they don't depend on each other directly.

## Usage

```tsx
import { DocxEditor, PluginHost, templatePlugin } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[templatePlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

### Custom Configuration

Use `createTemplatePlugin` for more control:

```tsx
import { DocxEditor, PluginHost } from '@eigenpal/docx-js-editor';
import { createPlugin } from '@eigenpal/docx-js-editor';

const myTemplatePlugin = createPlugin({
  panelPosition: 'left', // 'left' | 'right' (default: 'right')
  panelWidth: 320, // default: 280
  defaultCollapsed: true, // start with panel collapsed
});

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[myTemplatePlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

## Template Processing

To fill a template with data (outside the editor):

```tsx
import { processTemplate } from '@eigenpal/docx-js-editor';

const filled = await processTemplate(docxBuffer, {
  name: 'Jane Doe',
  company: 'Acme Inc.',
});
// filled is an ArrayBuffer of the populated .docx
```
