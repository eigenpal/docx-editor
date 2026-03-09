# @eigenpal/docx-js-editor — Agent Reference

> This document is for AI coding agents (Claude Code, Cursor, Copilot, etc.) that need to integrate the `@eigenpal/docx-js-editor` library. It covers the full API with code examples derived from the actual working examples in the repository.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Entry Points](#entry-points)
- [React Component (DocxEditor)](#react-component-docxeditor)
  - [Props](#props)
  - [Ref Methods](#ref-methods)
  - [Imperative Rendering (renderAsync)](#imperative-rendering-renderasync)
- [Headless API (DocumentAgent)](#headless-api-documentagent)
- [Template Processing](#template-processing)
- [Plugin System (EditorPlugin)](#plugin-system-editorplugin)
- [Document Model Types](#document-model-types)
- [Utilities](#utilities)
- [Framework Integration Examples](#framework-integration-examples)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)

---

## Overview

`@eigenpal/docx-js-editor` is an open-source, client-side WYSIWYG DOCX editor for the browser. It parses `.docx` files, renders them with Microsoft Word fidelity, and supports full editing — no backend required.

Key capabilities:

- **WYSIWYG editing** — formatting, tables, images, hyperlinks, headers/footers
- **Track changes** — suggestion mode with accept/reject
- **Comments** — threaded replies, resolve/reopen, scroll-to-highlight
- **Template variables** — `{variable}` substitution via docxtemplater
- **Headless API** — programmatic document manipulation (Node.js compatible)
- **Plugin system** — extend with custom UI panels and overlays

## Installation

```bash
npm install @eigenpal/docx-js-editor
```

Peer dependencies: `react >= 18.0.0`, `react-dom >= 18.0.0`.

## Entry Points

| Import Path                           | Environment        | Use Case                                                                           |
| ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `@eigenpal/docx-js-editor`            | Browser (React)    | Full editor component, toolbar, dialogs, all UI                                    |
| `@eigenpal/docx-js-editor/headless`   | Node.js or Browser | `DocumentAgent`, parsing, serialization, template processing — no React dependency |
| `@eigenpal/docx-js-editor/styles.css` | Browser            | **Required** CSS for editor rendering                                              |

---

## React Component (DocxEditor)

### Minimal Example

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);
  return <DocxEditor ref={editorRef} documentBuffer={file} onChange={() => {}} />;
}
```

### Full Example (from `examples/vite`)

This is the actual pattern used in the Vite example app:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DocxEditor,
  type DocxEditorRef,
  createEmptyDocument,
  type Document,
} from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function App() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('document.docx');

  // Load a sample DOCX on mount
  useEffect(() => {
    fetch('/sample.docx')
      .then((res) => res.arrayBuffer())
      .then((buffer) => setDocumentBuffer(buffer))
      .catch(() => {
        setCurrentDocument(createEmptyDocument());
        setFileName('Untitled.docx');
      });
  }, []);

  // Create a new blank document
  const handleNew = useCallback(() => {
    setCurrentDocument(createEmptyDocument());
    setDocumentBuffer(null);
    setFileName('Untitled.docx');
  }, []);

  // Open a .docx from file picker
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    setCurrentDocument(null);
    setDocumentBuffer(buffer);
    setFileName(file.name);
  }, []);

  // Save and download as .docx
  const handleSave = useCallback(async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [fileName]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header>
        <input type="file" accept=".docx" onChange={handleFileSelect} />
        <button onClick={handleNew}>New</button>
        <button onClick={handleSave}>Save</button>
      </header>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <DocxEditor
          ref={editorRef}
          document={documentBuffer ? undefined : currentDocument}
          documentBuffer={documentBuffer}
          author="User"
          onChange={() => {}}
          onError={(error) => console.error('Editor error:', error)}
          onFontsLoaded={() => console.log('Fonts loaded')}
          showToolbar={true}
          showRuler={true}
          showZoomControl={true}
          showPageNumbers={false}
          initialZoom={1.0}
        />
      </main>
    </div>
  );
}
```

**Key patterns from the examples:**

- Pass **either** `documentBuffer` (raw file) **or** `document` (parsed object) — not both at the same time
- Use `documentBuffer ? undefined : currentDocument` to switch between modes
- Use `createEmptyDocument()` for a blank starting document
- `editorRef.current.save()` returns an `ArrayBuffer` of the edited `.docx`

### Props

| Prop                   | Type                                        | Default           | Description                                        |
| ---------------------- | ------------------------------------------- | ----------------- | -------------------------------------------------- |
| `documentBuffer`       | `ArrayBuffer \| Uint8Array \| Blob \| File` | —                 | `.docx` file contents to load                      |
| `document`             | `Document`                                  | —                 | Pre-parsed document object (alternative to buffer) |
| `author`               | `string`                                    | `'User'`          | Author name for comments and track changes         |
| `readOnly`             | `boolean`                                   | `false`           | Disable editing, hide toolbar/rulers               |
| `showToolbar`          | `boolean`                                   | `true`            | Show the formatting toolbar                        |
| `showRuler`            | `boolean`                                   | `false`           | Show horizontal and vertical rulers                |
| `rulerUnit`            | `'inch' \| 'cm'`                            | `'inch'`          | Unit for ruler display                             |
| `showZoomControl`      | `boolean`                                   | `true`            | Show zoom controls in toolbar                      |
| `showPrintButton`      | `boolean`                                   | `true`            | Show print button in toolbar                       |
| `showPageNumbers`      | `boolean`                                   | `true`            | Show page number indicator                         |
| `enablePageNavigation` | `boolean`                                   | `true`            | Enable interactive page navigation                 |
| `pageNumberPosition`   | `string`                                    | `'bottom-center'` | Position of page number indicator                  |
| `showOutline`          | `boolean`                                   | `false`           | Show document outline sidebar                      |
| `showMarginGuides`     | `boolean`                                   | `false`           | Show page margin boundaries                        |
| `marginGuideColor`     | `string`                                    | `'#c0c0c0'`       | Color for margin guides                            |
| `initialZoom`          | `number`                                    | `1.0`             | Initial zoom level (1.0 = 100%)                    |
| `theme`                | `Theme \| null`                             | —                 | Theme override for colors/fonts                    |
| `toolbarExtra`         | `ReactNode`                                 | —                 | Custom items appended to toolbar                   |
| `placeholder`          | `ReactNode`                                 | —                 | Placeholder when no document loaded                |
| `loadingIndicator`     | `ReactNode`                                 | —                 | Custom loading indicator                           |
| `className`            | `string`                                    | —                 | Additional CSS class                               |
| `style`                | `CSSProperties`                             | —                 | Additional inline styles                           |
| `onChange`             | `(doc: Document) => void`                   | —                 | Called on document change                          |
| `onSave`               | `(buffer: ArrayBuffer) => void`             | —                 | Called on save                                     |
| `onError`              | `(error: Error) => void`                    | —                 | Called on error                                    |
| `onSelectionChange`    | `(state: SelectionState \| null) => void`   | —                 | Called on selection change                         |
| `onFontsLoaded`        | `() => void`                                | —                 | Called when fonts finish loading                   |
| `onPrint`              | `() => void`                                | —                 | Called when print is triggered                     |
| `onCopy`               | `() => void`                                | —                 | Called when content is copied                      |
| `onCut`                | `() => void`                                | —                 | Called when content is cut                         |
| `onPaste`              | `() => void`                                | —                 | Called when content is pasted                      |

### Ref Methods

Access via `useRef<DocxEditorRef>()`:

```ts
interface DocxEditorRef {
  getDocument(): Document | null;
  getAgent(): DocumentAgent | null;
  save(options?: { selective?: boolean }): Promise<ArrayBuffer | null>;
  setZoom(zoom: number): void;
  getZoom(): number;
  focus(): void;
  getCurrentPage(): number; // 1-indexed
  getTotalPages(): number;
  scrollToPage(pageNumber: number): void;
  openPrintPreview(): void;
  print(): void;
}
```

### Imperative Rendering (renderAsync)

For non-React apps or when you need imperative control:

```ts
import { renderAsync } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

const container = document.getElementById('editor')!;
const fileBuffer = await fetch('/template.docx').then((r) => r.arrayBuffer());

const handle = await renderAsync(fileBuffer, container, {
  showToolbar: true,
  initialZoom: 1.0,
  onChange: (doc) => console.log('changed'),
});

// Later:
const saved = await handle.save(); // Returns Blob | null
const doc = handle.getDocument(); // Returns Document | null
handle.setZoom(1.5); // Set zoom to 150%
handle.focus(); // Focus editor
handle.destroy(); // Unmount and clean up
```

---

## Headless API (DocumentAgent)

The `DocumentAgent` class provides a high-level, immutable API for programmatic document manipulation. Every write operation returns a **new** `DocumentAgent` instance — the original is never mutated.

Import from `@eigenpal/docx-js-editor/headless` (no React dependency).

### Creating an Agent

```ts
import { DocumentAgent } from '@eigenpal/docx-js-editor/headless';

// From a DOCX buffer (async — parses the file)
const agent = await DocumentAgent.fromBuffer(buffer);

// From a pre-parsed Document object (sync)
const agent = DocumentAgent.fromDocument(document);
```

### Reading Methods

```ts
agent.getText();                          // Full plain text
agent.getFormattedText();                 // Array of { text, formatting } segments
agent.getVariables();                     // Template variables found: ['name', 'date']
agent.getStyles();                        // Available styles: [{ id, name, type }]
agent.getPageCount();                     // Estimated page count (~500 words/page)
agent.getWordCount();                     // Total word count
agent.getCharacterCount(includeSpaces?);  // Total characters
agent.getParagraphCount();                // Total paragraphs
agent.getTableCount();                    // Total tables
agent.getDocument();                      // Raw Document model object
```

### Writing Methods

All write methods return a new `DocumentAgent`. Chain them:

```ts
const result = agent
  .insertText({ paragraphIndex: 0, offset: 0 }, 'Hello ')
  .applyFormatting(
    { start: { paragraphIndex: 0, offset: 0 }, end: { paragraphIndex: 0, offset: 5 } },
    { bold: true }
  )
  .insertParagraphBreak({ paragraphIndex: 0, offset: 6 });
```

#### Text Operations

```ts
agent.insertText(position, text, options?): DocumentAgent
agent.replaceRange(range, text, options?): DocumentAgent
agent.deleteRange(range): DocumentAgent
```

#### Formatting

```ts
agent.applyFormatting(range, formatting): DocumentAgent
agent.applyParagraphFormatting(paragraphIndex, formatting): DocumentAgent
agent.applyStyle(paragraphIndex, styleId): DocumentAgent
```

#### Structural Operations

```ts
agent.insertTable(position, rows, cols, options?): DocumentAgent
agent.insertImage(position, src, options?): DocumentAgent
agent.insertHyperlink(range, url, options?): DocumentAgent
agent.removeHyperlink(range): DocumentAgent
agent.insertParagraphBreak(position): DocumentAgent
agent.mergeParagraphs(startParagraphIndex, count): DocumentAgent
```

### Template Variables

```ts
const filled = agent.setVariable('name', 'Jane Doe').setVariable('date', '2025-01-15');

// Or set multiple at once
const filled = agent.setVariables({ name: 'Jane Doe', date: '2025-01-15' });

// Apply all pending variables (async — uses docxtemplater internally)
const final = await filled.applyVariables();
```

### Exporting

```ts
const buffer: ArrayBuffer = await agent.toBuffer();
const blob: Blob = await agent.toBlob();
```

### Position and Range Types

```ts
interface Position {
  paragraphIndex: number; // 0-indexed paragraph in document body
  offset: number; // Character offset within paragraph text
}

interface Range {
  start: Position;
  end: Position;
}
```

---

## Template Processing

Standalone functions for template variable substitution. Uses docxtemplater under the hood.

```ts
import {
  processTemplate,
  processTemplateDetailed,
  processTemplateAsBlob,
  getTemplateTags,
  validateTemplate,
} from '@eigenpal/docx-js-editor';

// Simple substitution — returns ArrayBuffer
const result = processTemplate(templateBuffer, {
  name: 'Jane Doe',
  company: 'Acme Corp',
});

// With detailed result metadata
const { buffer, replacedVariables, unreplacedVariables, warnings } = processTemplateDetailed(
  templateBuffer,
  variables
);

// As Blob for download
const blob = processTemplateAsBlob(templateBuffer, variables);

// List all template tags
const tags = getTemplateTags(templateBuffer);

// Validate template syntax
const { valid, errors, tags } = validateTemplate(templateBuffer);
```

---

## Plugin System (EditorPlugin)

Plugins add UI panels, overlays, and ProseMirror extensions to the editor. Wrap `<DocxEditor>` in `<PluginHost>`.

### Word Count Plugin (from `examples/plugins/hello-world`)

This is the actual working example from the repository:

```tsx
import type { EditorPlugin, PluginPanelProps } from '@eigenpal/docx-js-editor';
import React from 'react';

interface WordCountState {
  words: number;
  characters: number;
  paragraphs: number;
}

function WordCountPanel({ pluginState }: PluginPanelProps<WordCountState>) {
  const { words, characters, paragraphs } = pluginState ?? {
    words: 0,
    characters: 0,
    paragraphs: 0,
  };
  return React.createElement(
    'div',
    { style: { padding: 16 } },
    React.createElement('h3', null, 'Word Count'),
    React.createElement('p', null, `Words: ${words}`),
    React.createElement('p', null, `Characters: ${characters}`),
    React.createElement('p', null, `Paragraphs: ${paragraphs}`)
  );
}

export const wordCountPlugin: EditorPlugin<WordCountState> = {
  id: 'word-count',
  name: 'Word Count',
  Panel: WordCountPanel,
  panelConfig: {
    position: 'right',
    defaultSize: 220,
    minSize: 180,
    collapsible: true,
    defaultCollapsed: false,
  },
  initialize: () => ({ words: 0, characters: 0, paragraphs: 0 }),
  onStateChange(view) {
    const text = view.state.doc.textContent;
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      characters: text.length,
      paragraphs: view.state.doc.childCount,
    };
  },
};
```

### Using a Plugin

```tsx
import { DocxEditor, PluginHost, createEmptyDocument } from '@eigenpal/docx-js-editor';
import { wordCountPlugin } from './wordCountPlugin';

function App() {
  return (
    <PluginHost plugins={[wordCountPlugin]}>
      <DocxEditor document={createEmptyDocument()} showToolbar showRuler />
    </PluginHost>
  );
}
```

### Template Plugin (built-in)

The library ships with a `templatePlugin` for editing docxtemplater `{variable}` tags with syntax highlighting and an annotation panel:

```tsx
import {
  DocxEditor,
  PluginHost,
  templatePlugin,
  createEmptyDocument,
} from '@eigenpal/docx-js-editor';

// From examples/plugins/docxtemplater:
function App() {
  return (
    <PluginHost plugins={[templatePlugin]}>
      <DocxEditor document={createEmptyDocument()} showToolbar showRuler />
    </PluginHost>
  );
}
```

### EditorPlugin Interface

```ts
interface EditorPlugin<TState = any> {
  id: string;
  name: string;
  Panel?: React.ComponentType<PluginPanelProps<TState>>;
  panelConfig?: {
    position: 'left' | 'right' | 'bottom';
    defaultSize?: number;
    minSize?: number;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
  };
  onStateChange?: (view: EditorView) => TState | undefined;
  initialize?: (view: EditorView | null) => TState;
  destroy?: () => void;
  styles?: string; // CSS injected at mount
  proseMirrorPlugins?: ProseMirrorPlugin[];
  renderOverlay?: (context, state, editorView) => ReactNode;
}
```

---

## Document Model Types

The document model maps to ECMA-376 (Office Open XML).

```ts
interface Document {
  package: DocxPackage;
  originalBuffer?: ArrayBuffer;
}

interface DocxPackage {
  document: DocumentBody;
  styles?: StyleDefinitions;
  numbering?: NumberingDefinitions;
  theme?: Theme;
}

interface DocumentBody {
  content: BlockContent[]; // Paragraphs and tables
}

type BlockContent = Paragraph | Table;
```

### Paragraph and Run

```ts
interface Paragraph {
  type: 'paragraph';
  content: ParagraphContent[];
  formatting?: ParagraphFormatting;
}

type ParagraphContent = Run | Hyperlink;

interface Run {
  type: 'run';
  content: RunContent[];
  formatting?: TextFormatting;
}

type RunContent =
  | { type: 'text'; text: string }
  | { type: 'break'; breakType: 'page' | 'column' | 'line' }
  | { type: 'tab' }
  | Image;
```

### TextFormatting

```ts
interface TextFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: 'single' | 'double' | 'dotted' | 'dash' | 'wave' | 'none';
  strikethrough?: boolean;
  fontSize?: number; // In half-points (24 = 12pt)
  fontFamily?: string;
  color?: Color;
  highlight?: string;
  superscript?: boolean;
  subscript?: boolean;
  allCaps?: boolean;
  smallCaps?: boolean;
}
```

### ParagraphFormatting

```ts
interface ParagraphFormatting {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: LineSpacing;
  indent?: {
    left?: number; // In twips (1440 twips = 1 inch)
    right?: number;
    firstLine?: number;
    hanging?: number;
  };
  spaceBefore?: number;
  spaceAfter?: number;
}
```

### Table

```ts
interface Table {
  type: 'table';
  rows: TableRow[];
  formatting?: TableFormatting;
}

interface TableRow {
  cells: TableCell[];
  height?: number;
}

interface TableCell {
  content: BlockContent[];
  columnSpan?: number;
  rowSpan?: number;
  shading?: Color;
}
```

### Other Types

```ts
interface Hyperlink {
  type: 'hyperlink';
  children: Run[];
  url?: string;
  anchor?: string;
  tooltip?: string;
}

interface Image {
  type: 'image';
  src: string; // Base64 data URL or relative path
  width?: number; // In EMUs (914400 EMUs = 1 inch)
  height?: number;
  alt?: string;
}

interface Color {
  type: 'rgb' | 'theme';
  value: string;
  tint?: number;
}
```

---

## Utilities

### Unit Conversion

```ts
import {
  twipsToPixels,
  pixelsToTwips,
  emuToPixels,
  pointsToPixels,
  halfPointsToPixels,
} from '@eigenpal/docx-js-editor';

twipsToPixels(1440); // 96 (1 inch at 96 DPI)
pixelsToTwips(96); // 1440
emuToPixels(914400); // 96
pointsToPixels(12); // 16
halfPointsToPixels(24); // 16 (24 half-points = 12pt)
```

### Color Resolution

```ts
import { resolveColor, createThemeColor, createRgbColor } from '@eigenpal/docx-js-editor';

resolveColor({ type: 'theme', value: 'accent1' }, theme); // '#4472C4'
resolveColor({ type: 'rgb', value: 'FF0000' }); // '#FF0000'
createRgbColor('FF0000'); // { type: 'rgb', value: 'FF0000' }
```

### Font Loading

```ts
import { loadFont, loadFonts, isFontLoaded, onFontsLoaded } from '@eigenpal/docx-js-editor';

await loadFont('Calibri', '/fonts/Calibri.ttf');
await loadFonts([
  { name: 'Calibri', url: '/fonts/Calibri.ttf' },
  { name: 'Arial', url: '/fonts/Arial.ttf' },
]);
isFontLoaded('Calibri'); // boolean
onFontsLoaded(() => console.log('ready'));
```

---

## Framework Integration Examples

These patterns come from the actual example apps in the `examples/` directory.

### Next.js (from `examples/nextjs`)

The editor requires the DOM, so it must be dynamically imported with `ssr: false`:

```tsx
// app/page.tsx
'use client';

import dynamic from 'next/dynamic';

const Editor = dynamic(() => import('./components/Editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => <div>Loading DOCX Editor...</div>,
});

export default function Page() {
  return <Editor />;
}
```

```tsx
// app/components/Editor.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DocxEditor,
  type DocxEditorRef,
  createEmptyDocument,
  type Document,
} from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

export function Editor() {
  const editorRef = useRef<DocxEditorRef>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    fetch('/sample.docx')
      .then((res) => res.arrayBuffer())
      .then(setDocumentBuffer)
      .catch(() => {});
  }, []);

  return (
    <DocxEditor
      ref={editorRef}
      documentBuffer={documentBuffer}
      document={documentBuffer ? undefined : createEmptyDocument()}
      onChange={() => {}}
      onError={(error) => console.error(error)}
      showToolbar
      showRuler
      showZoomControl
      initialZoom={1.0}
    />
  );
}
```

### Remix (from `examples/remix`)

Same pattern — the `Editor` component imports `@eigenpal/docx-js-editor` and is used in a client-only route. The component code is identical to the Next.js editor component above.

### Astro (from `examples/astro`)

Astro uses React islands. The Editor component is a standard React component (same as above), rendered as a client island:

```astro
---
// src/pages/index.astro
---
<Layout>
  <Editor client:only="react" />
</Layout>
```

### Vue

Vue support is a scaffold — contributions welcome. For now, use `renderAsync` for imperative rendering in Vue:

```vue
<template>
  <div ref="editorContainer" style="height: 100vh" />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const editorContainer = ref(null);
let handle = null;

onMounted(async () => {
  const { renderAsync } = await import('@eigenpal/docx-js-editor');
  await import('@eigenpal/docx-js-editor/styles.css');
  const buffer = await fetch('/template.docx').then((r) => r.arrayBuffer());
  handle = await renderAsync(buffer, editorContainer.value);
});

onUnmounted(() => handle?.destroy());
</script>
```

---

## Common Patterns

### Save and Download

From all the example apps — this is the standard save pattern:

```ts
const buffer = await editorRef.current?.save();
if (buffer) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

### Read-Only Viewer

```tsx
<DocxEditor documentBuffer={file} readOnly />
```

### Toggle Between Read-Only and Editing

From the Vite example:

```tsx
const [readOnly, setReadOnly] = useState(false);

<DocxEditor documentBuffer={file} readOnly={readOnly} />
<button onClick={() => setReadOnly(v => !v)}>
  {readOnly ? 'Switch to Editing' : 'Switch to Read Only'}
</button>
```

### Create a Template Document Programmatically

From `examples/plugins/docxtemplater`:

```ts
import { createEmptyDocument, type Document } from '@eigenpal/docx-js-editor';

function createTemplateDocument(): Document {
  const doc = createEmptyDocument();
  const body = doc.package.document;

  // Modify the first paragraph
  if (body.content.length > 0 && body.content[0].type === 'paragraph') {
    body.content[0].content = [{ type: 'run', content: [{ type: 'text', text: 'Dear {name},' }] }];
  }

  // Add more paragraphs
  body.content.push(
    { type: 'paragraph', content: [], formatting: {} },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: 'Thank you for your order.' }] }],
      formatting: {},
    },
    {
      type: 'paragraph',
      content: [{ type: 'run', content: [{ type: 'text', text: 'Total: ${total}' }] }],
      formatting: {},
    }
  );

  return doc;
}
```

### Responsive Zoom

From the Vite example — auto-fit zoom for narrow viewports:

```ts
function useResponsiveZoom() {
  const calcZoom = () => {
    const pageWidth = 816 + 48; // 8.5in * 96dpi + padding
    const vw = window.innerWidth;
    return vw < pageWidth ? Math.max(0.35, Math.floor((vw / pageWidth) * 20) / 20) : 1.0;
  };

  const [zoom, setZoom] = useState(calcZoom);

  useEffect(() => {
    const onResize = () => setZoom(calcZoom());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return zoom;
}

// Usage:
<DocxEditor initialZoom={zoom} ... />
```

---

## Troubleshooting

### "document is not defined" / SSR Error

The editor requires the DOM. Use dynamic imports in Next.js / SSR frameworks:

```tsx
const DocxEditor = dynamic(() => import('@eigenpal/docx-js-editor').then((m) => m.DocxEditor), {
  ssr: false,
});
```

### CSS conflicts with Tailwind

The editor's CSS is scoped under `.ep-root`. This class is applied automatically by `<DocxEditor>`.

### Template variables not replaced

- Variable names are case-sensitive
- Word sometimes splits `{name}` across multiple XML runs (`{`, `name`, `}`). Use `getTemplateTags()` to verify what the parser sees
- Use `validateTemplate()` to check for syntax errors

---

## Links

- [npm package](https://www.npmjs.com/package/@eigenpal/docx-js-editor)
- [GitHub repository](https://github.com/eigenpal/docx-editor)
- [Live demo](https://docx-js-editor.vercel.app/)
- [Props & Ref Methods](docs/PROPS.md)
- [Plugin System](docs/PLUGINS.md)
- [Architecture](docs/ARCHITECTURE.md)
