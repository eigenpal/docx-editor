# @eigenpal/docx-js-editor — Agent Reference

> This document is written for AI coding agents (Claude Code, Cursor, Copilot, etc.) that need to integrate, extend, or work with the `@eigenpal/docx-js-editor` library. It provides exhaustive API details, code examples, and architectural context that agents need to generate correct code on the first attempt.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Entry Points](#entry-points)
- [React Component (DocxEditor)](#react-component-docxeditor)
  - [Props](#props)
  - [Ref Methods](#ref-methods)
  - [Imperative Rendering (renderAsync)](#imperative-rendering-renderasync)
- [Headless API (DocumentAgent)](#headless-api-documentagent)
  - [Creating an Agent](#creating-an-agent)
  - [Reading Methods](#reading-methods)
  - [Writing Methods](#writing-methods)
  - [Template Variables](#template-variables)
  - [Exporting](#exporting)
- [Template Processing](#template-processing)
- [Agent Context API (for AI Integration)](#agent-context-api-for-ai-integration)
- [Command Execution (Low-Level)](#command-execution-low-level)
- [Document Parsing and Serialization](#document-parsing-and-serialization)
- [Plugin System](#plugin-system)
  - [EditorPlugin (Browser/React)](#editorplugin-browserreact)
  - [CorePlugin (Headless/Node.js)](#coreplugin-headlessnodejs)
- [MCP Server (AI Tool Integration)](#mcp-server-ai-tool-integration)
- [Document Model Types](#document-model-types)
- [Utilities](#utilities)
- [Framework Integration](#framework-integration)
- [Common Patterns and Recipes](#common-patterns-and-recipes)
- [Troubleshooting](#troubleshooting)

---

## Overview

`@eigenpal/docx-js-editor` is an open-source, client-side WYSIWYG DOCX editor for the browser. It parses `.docx` files, renders them with Microsoft Word fidelity, and supports full editing — all without a backend.

Key capabilities:

- **WYSIWYG editing** — formatting, tables, images, hyperlinks, headers/footers
- **Track changes** — suggestion mode with accept/reject
- **Comments** — threaded replies, resolve/reopen
- **Template variables** — `{variable}` substitution via docxtemplater
- **Headless API** — programmatic document manipulation (Node.js compatible)
- **Plugin system** — extend with custom panels, commands, and MCP tools
- **MCP server** — expose document tools to AI clients

## Installation

```bash
npm install @eigenpal/docx-js-editor
# or
yarn add @eigenpal/docx-js-editor
# or
pnpm add @eigenpal/docx-js-editor
```

Peer dependencies: `react >= 18.0.0`, `react-dom >= 18.0.0` (optional for headless usage).

## Entry Points

| Import Path                             | Environment        | Use Case                                                                           |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `@eigenpal/docx-js-editor`              | Browser (React)    | Full editor component, toolbar, dialogs, all UI                                    |
| `@eigenpal/docx-js-editor/headless`     | Node.js or Browser | `DocumentAgent`, parsing, serialization, template processing — no React dependency |
| `@eigenpal/docx-js-editor/core-plugins` | Node.js or Browser | Plugin registry, `docxtemplaterPlugin`, command handlers                           |
| `@eigenpal/docx-js-editor/mcp`          | Node.js            | MCP server for AI tool integration                                                 |
| `@eigenpal/docx-js-editor/styles.css`   | Browser            | Required CSS for editor rendering                                                  |

---

## React Component (DocxEditor)

### Minimal Example

```tsx
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';
import '@eigenpal/docx-js-editor/styles.css';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);

  const handleSave = async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      // download or upload blob
    }
  };

  return (
    <div style={{ height: '100vh' }}>
      <DocxEditor
        ref={editorRef}
        documentBuffer={file}
        onChange={(doc) => console.log('Document changed', doc)}
        onError={(err) => console.error(err)}
      />
    </div>
  );
}
```

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
  // Document access
  getDocument(): Document | null;
  getAgent(): DocumentAgent | null;

  // Save/export
  save(options?: { selective?: boolean }): Promise<ArrayBuffer | null>;

  // Zoom
  setZoom(zoom: number): void;
  getZoom(): number;

  // Navigation
  focus(): void;
  getCurrentPage(): number; // 1-indexed
  getTotalPages(): number;
  scrollToPage(pageNumber: number): void;

  // Print
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

**`RenderAsyncOptions`** accepts all the same visual props as `DocxEditor` (`readOnly`, `showToolbar`, `showZoomControl`, `showPageNumbers`, `enablePageNavigation`, `showMarginGuides`, `showRuler`, `initialZoom`, `author`, `onChange`, `onError`, `onSave`).

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
agent.getAgentContext(outlineMaxChars?);  // Full document context for AI (see below)
```

### Writing Methods

All write methods return a new `DocumentAgent`. Chain them for multiple operations:

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
// Insert text at position
agent.insertText(position: Position, text: string, options?: { formatting?: TextFormatting }): DocumentAgent

// Replace text in range
agent.replaceRange(range: Range, text: string, options?: { formatting?: TextFormatting }): DocumentAgent

// Delete text in range
agent.deleteRange(range: Range): DocumentAgent
```

#### Formatting

```ts
// Apply character formatting (bold, italic, font, color, etc.)
agent.applyFormatting(range: Range, formatting: Partial<TextFormatting>): DocumentAgent

// Apply paragraph formatting (alignment, spacing, indent, etc.)
agent.applyParagraphFormatting(paragraphIndex: number, formatting: Partial<ParagraphFormatting>): DocumentAgent

// Apply a named style
agent.applyStyle(paragraphIndex: number, styleId: string): DocumentAgent
```

#### Structural Operations

```ts
// Insert a table
agent.insertTable(position: Position, rows: number, cols: number, options?: {
  data?: string[][];       // 2D array of cell text
  hasHeader?: boolean;
}): DocumentAgent

// Insert an image
agent.insertImage(position: Position, src: string, options?: {
  width?: number;          // pixels
  height?: number;         // pixels
  alt?: string;
}): DocumentAgent

// Insert / remove hyperlink
agent.insertHyperlink(range: Range, url: string, options?: {
  displayText?: string;
  tooltip?: string;
}): DocumentAgent
agent.removeHyperlink(range: Range): DocumentAgent

// Paragraph operations
agent.insertParagraphBreak(position: Position): DocumentAgent
agent.mergeParagraphs(startParagraphIndex: number, count: number): DocumentAgent
```

### Template Variables

```ts
// Set variables (chainable, deferred until applyVariables)
const filled = agent.setVariable('name', 'Jane Doe').setVariable('date', '2025-01-15');

// Or set multiple at once
const filled = agent.setVariables({ name: 'Jane Doe', date: '2025-01-15' });

// Inspect pending variables
filled.getPendingVariables(); // { name: 'Jane Doe', date: '2025-01-15' }

// Apply all pending variables (async — uses docxtemplater internally)
const final = await filled.applyVariables();

// Or apply directly without setting first
const final = await agent.applyVariables({ name: 'Jane Doe', date: '2025-01-15' });

// Clear pending variables without applying
agent.clearPendingVariables();
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
  contentIndex?: number; // Optional: specific content block index
  sectionIndex?: number; // Optional: section index
}

interface Range {
  start: Position;
  end: Position;
  collapsed?: boolean; // true if start === end (cursor position)
}
```

---

## Template Processing

Standalone functions for template variable substitution without the full editor. Uses docxtemplater under the hood.

```ts
import {
  processTemplate,
  processTemplateDetailed,
  processTemplateAsBlob,
  getTemplateTags,
  validateTemplate,
} from '@eigenpal/docx-js-editor';
```

### Basic Usage

```ts
// Simple substitution — returns ArrayBuffer
const result = processTemplate(templateBuffer, {
  name: 'Jane Doe',
  company: 'Acme Corp',
  date: '2025-01-15',
});

// With detailed result metadata
const { buffer, replacedVariables, unreplacedVariables, warnings } = processTemplateDetailed(
  templateBuffer,
  variables
);

// As Blob for download
const blob = processTemplateAsBlob(templateBuffer, variables);
```

### Inspection

```ts
// List all template tags
const tags = getTemplateTags(templateBuffer);
// → ['name', 'company', 'date', 'items']

// Validate template syntax
const { valid, errors, tags } = validateTemplate(templateBuffer);
```

### Options

```ts
interface ProcessTemplateOptions {
  nullGetter?: 'keep' | 'empty' | 'error'; // How to handle undefined variables
  linebreaks?: boolean; // Convert \n in values to line breaks
  delimiters?: { start?: string; end?: string }; // Custom delimiters (default: { and })
}
```

---

## Agent Context API (for AI Integration)

Build structured, JSON-serializable context objects describing a document. Designed for feeding into AI/LLM prompts.

```ts
import { getAgentContext, buildSelectionContext } from '@eigenpal/docx-js-editor';
```

### Document Context

```ts
const context = getAgentContext(document, {
  outlineMaxChars: 100, // Characters per paragraph preview (default: 100)
  maxOutlineParagraphs: 50, // Max paragraphs in outline (default: 50)
  includeTableContent: false, // Include table text in outline
  includeFormatting: false, // Include formatting details
});
```

Returns:

```ts
interface AgentContext {
  paragraphCount: number;
  wordCount: number;
  characterCount: number;
  variables: string[]; // Detected {variable} placeholders
  variableCount: number;
  availableStyles: StyleInfo[];
  outline: ParagraphOutline[]; // Preview of each paragraph
  sections: SectionInfo[];
  hasTables: boolean;
  hasImages: boolean;
  hasHyperlinks: boolean;
  language?: string;
}

interface ParagraphOutline {
  index: number;
  preview: string; // First N characters
  style?: string;
  isHeading?: boolean;
  headingLevel?: number; // 1-9 if heading
  isListItem?: boolean;
  isEmpty?: boolean;
}
```

### Selection Context

```ts
const selContext = buildSelectionContext(document, range, {
  contextCharsBefore: 200, // Characters of context before selection
  contextCharsAfter: 200, // Characters of context after selection
  includeSuggestions: true, // Include suggested AI actions
  maxSuggestions: 8,
});
```

Returns:

```ts
interface SelectionContext {
  selectedText: string;
  range: Range;
  formatting: Partial<TextFormatting>;
  paragraphFormatting: Partial<ParagraphFormatting>;
  textBefore: string;
  textAfter: string;
  paragraph: ParagraphContext;
  inTable?: boolean;
  inHyperlink?: boolean;
  suggestedActions?: SuggestedAction[];
}
```

---

## Command Execution (Low-Level)

For direct document manipulation without `DocumentAgent`:

```ts
import { executeCommand, executeCommands } from '@eigenpal/docx-js-editor';

// Single command
const newDoc = executeCommand(doc, {
  type: 'insertText',
  position: { paragraphIndex: 0, offset: 0 },
  text: 'Hello world',
});

// Multiple commands (applied sequentially)
const newDoc = executeCommands(doc, [
  { type: 'insertText', position: { paragraphIndex: 0, offset: 0 }, text: 'Title' },
  {
    type: 'formatText',
    range: { start: { paragraphIndex: 0, offset: 0 }, end: { paragraphIndex: 0, offset: 5 } },
    formatting: { bold: true, fontSize: 28 },
  },
  { type: 'applyStyle', paragraphIndex: 0, style: 'Heading1' },
]);
```

### Supported Command Types

| Command Type           | Fields                                            | Description                  |
| ---------------------- | ------------------------------------------------- | ---------------------------- |
| `insertText`           | `position`, `text`, `formatting?`                 | Insert text at position      |
| `replaceText`          | `range`, `text`, `formatting?`                    | Replace text in range        |
| `deleteText`           | `range`                                           | Delete text in range         |
| `formatText`           | `range`, `formatting`                             | Apply character formatting   |
| `formatParagraph`      | `paragraphIndex`, `formatting`                    | Apply paragraph formatting   |
| `applyStyle`           | `paragraphIndex`, `style`                         | Apply named style            |
| `insertTable`          | `position`, `rows`, `cols`, `data?`, `hasHeader?` | Insert table                 |
| `insertImage`          | `position`, `src`, `width?`, `height?`, `alt?`    | Insert image                 |
| `insertHyperlink`      | `range`, `url`, `displayText?`, `tooltip?`        | Create hyperlink             |
| `removeHyperlink`      | `range`                                           | Remove hyperlink             |
| `insertParagraphBreak` | `position`                                        | Split paragraph              |
| `mergeParagraphs`      | `startParagraphIndex`, `count`                    | Merge paragraphs             |
| `setVariable`          | `name`, `value`                                   | Set template variable        |
| `applyVariables`       | `variables`                                       | Apply all template variables |

---

## Document Parsing and Serialization

```ts
import { parseDocx, serializeDocx } from '@eigenpal/docx-js-editor';
import { createEmptyDocument, createDocumentWithText } from '@eigenpal/docx-js-editor';

// Parse DOCX to Document model
const doc = await parseDocx(buffer); // buffer: ArrayBuffer | Uint8Array | Blob | File

// Serialize Document back to DOCX XML
const xml = serializeDocx(doc);

// Create new documents
const emptyDoc = createEmptyDocument();
const textDoc = await createDocumentWithText('Hello world');
```

---

## Plugin System

The library has **two independent plugin systems** for different environments:

| System           | Environment        | Purpose                                      | Registration                    |
| ---------------- | ------------------ | -------------------------------------------- | ------------------------------- |
| **EditorPlugin** | Browser (React)    | UI panels, overlays, ProseMirror decorations | Declarative via `<PluginHost>`  |
| **CorePlugin**   | Node.js or Browser | Command handlers, MCP tools                  | Imperative via `pluginRegistry` |

### EditorPlugin (Browser/React)

Add UI panels, overlays, and ProseMirror plugins to the editor.

```tsx
import { DocxEditor, PluginHost, type EditorPlugin } from '@eigenpal/docx-js-editor';

const wordCountPlugin: EditorPlugin<{ words: number }> = {
  id: 'word-count',
  name: 'Word Count',

  // Called on every editor state change
  onStateChange(view) {
    const text = view.state.doc.textContent;
    return { words: text.split(/\s+/).filter(Boolean).length };
  },

  // Optional: render a panel (left, right, or bottom)
  Panel({ pluginState }) {
    return <div>Words: {pluginState?.words ?? 0}</div>;
  },
  panelConfig: { position: 'right', width: 200, title: 'Word Count' },

  // Optional: render overlay positioned over the editor pages
  renderOverlay(context, state, editorView) {
    // context.getCoordinatesForPosition(pmPos) → {x, y, height}
    return null;
  },

  // Optional: inject ProseMirror plugins
  proseMirrorPlugins: [],

  // Optional: inject CSS (scoped recommended)
  styles: `.word-count-panel { padding: 8px; }`,

  // Lifecycle
  initialize(view) {
    return { words: 0 };
  },
  destroy() {},
};

function App() {
  return (
    <PluginHost plugins={[wordCountPlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

#### PluginHost Ref

```tsx
const hostRef = useRef<PluginHostRef>(null);

// Get/set plugin state from outside
hostRef.current?.getPluginState<{ words: number }>('word-count');
hostRef.current?.setPluginState('word-count', { words: 42 });
hostRef.current?.getEditorView(); // ProseMirror EditorView
hostRef.current?.refreshPluginStates(); // Force re-render
```

#### RenderedDomContext (Position Mapping)

In `renderOverlay`, the `context` parameter provides position mapping between ProseMirror document positions and pixel coordinates on the visible pages:

```ts
context.getCoordinatesForPosition(pmPos); // → { x, y, height } | null
context.getRectsForRange(from, to); // → [{ x, y, width, height }, ...]
context.findElementsForRange(from, to); // → Element[]
context.getContainerOffset(); // → { x, y }
```

### CorePlugin (Headless/Node.js)

Add command handlers and MCP tools for server-side document manipulation.

```ts
import { pluginRegistry, type CorePlugin } from '@eigenpal/docx-js-editor/core-plugins';

const myPlugin: CorePlugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',

  // Command handlers (pure functions: Document → Document)
  commandHandlers: {
    myCustomCommand: (doc, command) => {
      // Transform and return new Document
      return { ...doc };
    },
  },

  // MCP tools exposed to AI clients
  mcpTools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: async (input, context) => {
        return { content: [{ type: 'text', text: 'Result' }] };
      },
    },
  ],

  // Lifecycle
  initialize: async () => {},
  destroy: async () => {},
  dependencies: [], // Other plugin IDs this depends on
};

pluginRegistry.register(myPlugin);
```

#### Built-in CorePlugin: docxtemplater

```ts
import { pluginRegistry, docxtemplaterPlugin } from '@eigenpal/docx-js-editor/core-plugins';

pluginRegistry.register(docxtemplaterPlugin);

// Now available:
// - Command handler: 'insertTemplateVariable'
// - Command handler: 'replaceWithTemplateVariable'
// - MCP tools: docx_get_variables, docx_insert_variable, docx_apply_template, docx_validate_template
```

#### Registry API

```ts
pluginRegistry.has('my-plugin'); // boolean
pluginRegistry.get('my-plugin'); // CorePlugin | undefined
pluginRegistry.getAll(); // CorePlugin[]
pluginRegistry.getCommandHandler('myCustomCommand'); // CommandHandler | undefined
pluginRegistry.getCommandTypes(); // string[]
pluginRegistry.getMcpTools(); // McpToolDefinition[]
pluginRegistry.unregister('my-plugin'); // boolean
```

---

## MCP Server (AI Tool Integration)

Expose document manipulation tools to AI clients via the Model Context Protocol.

```ts
import { createMcpServer, startStdioServer } from '@eigenpal/docx-js-editor/mcp';

// Create server with built-in tools
const server = createMcpServer({
  name: 'docx-editor',
  version: '0.1.0',
  includeCoreTools: true,
  debug: true,
});

// List available tools
const tools = server.listTools();

// Call a tool programmatically
const result = await server.handleToolCall('docx_load', {
  content: base64String,
  source: 'document.docx',
});

// Start stdio server for Claude Desktop / other MCP clients
startStdioServer();
```

### Built-in MCP Tools

| Tool                | Description                           | Read-only |
| ------------------- | ------------------------------------- | --------- |
| `docx_load`         | Load DOCX from base64 into session    | Yes       |
| `docx_save`         | Save document as base64               | Yes       |
| `docx_close`        | Remove document from session          | No        |
| `docx_info`         | Get word count, paragraphs, variables | Yes       |
| `docx_text`         | Extract all text                      | Yes       |
| `docx_insert_text`  | Insert text at position               | No        |
| `docx_replace_text` | Replace text in range                 | No        |
| `docx_delete_text`  | Delete text in range                  | No        |
| `docx_format_text`  | Apply formatting (bold, italic, etc.) | No        |
| `docx_apply_style`  | Apply paragraph style                 | No        |

After registering `docxtemplaterPlugin`:

| Tool                     | Description                  |
| ------------------------ | ---------------------------- |
| `docx_get_variables`     | List all `{variable}` tags   |
| `docx_insert_variable`   | Insert `{name}` at position  |
| `docx_apply_template`    | Fill all variables with data |
| `docx_validate_template` | Check template syntax        |

### Custom MCP Tool

```ts
const tool: McpToolDefinition = {
  name: 'docx_summarize',
  description: 'Summarize document contents',
  inputSchema: {
    type: 'object',
    properties: {
      documentId: { type: 'string' },
      maxLength: { type: 'number', default: 200 },
    },
    required: ['documentId'],
  },
  handler: async (input, context) => {
    const doc = context.session.documents.get(input.documentId);
    if (!doc) return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
    const text = getBodyText(doc.document.package.document);
    return {
      content: [{ type: 'text', text: text.slice(0, input.maxLength) }],
    };
  },
  annotations: {
    category: 'analysis',
    readOnly: true,
    complexity: 'low',
  },
};
```

---

## Document Model Types

The core document model maps closely to the ECMA-376 (Office Open XML) specification.

### Key Types

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
  rels?: Relationship[];
  footnotes?: Footnote[];
  endnotes?: Endnote[];
}

interface DocumentBody {
  content: BlockContent[]; // Paragraphs and tables
  sections?: Section[];
}

type BlockContent = Paragraph | Table;
```

### Paragraph

```ts
interface Paragraph {
  type: 'paragraph';
  content: ParagraphContent[]; // Runs and hyperlinks
  formatting?: ParagraphFormatting;
  listRendering?: ListRendering;
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
  | Image
  | Shape;
```

### TextFormatting

```ts
interface TextFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: 'single' | 'double' | 'dotted' | 'dash' | 'dashDot' | 'wave' | 'none';
  strikethrough?: boolean;
  fontSize?: number; // In half-points (24 = 12pt)
  fontFamily?: string;
  color?: Color;
  highlight?: string;
  superscript?: boolean;
  subscript?: boolean;
  allCaps?: boolean;
  smallCaps?: boolean;
  spacing?: number; // Character spacing
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
  spaceBefore?: number; // In twips
  spaceAfter?: number; // In twips
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
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
  content: BlockContent[]; // Can contain paragraphs and nested tables
  columnSpan?: number;
  rowSpan?: number;
  shading?: Color;
}
```

### Other Key Types

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
  value: string; // Hex for rgb, theme color name for theme
  tint?: number; // -1.0 to 1.0
}

interface Style {
  id: string;
  name: string;
  type: 'paragraph' | 'character' | 'table' | 'list';
  default?: boolean;
  formatting?: TextFormatting & ParagraphFormatting;
}

interface SectionProperties {
  pageSize?: { width: number; height: number }; // In twips
  margins?: { top: number; right: number; bottom: number; left: number };
  orientation?: 'portrait' | 'landscape';
  headerReferences?: HeaderReference[];
  footerReferences?: FooterReference[];
}
```

---

## Utilities

### Unit Conversion

DOCX uses twips (1/1440 inch) and EMUs (1/914400 inch) internally. Use these to convert:

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

Resolve theme colors and manipulate colors:

```ts
import {
  resolveColor,
  createThemeColor,
  createRgbColor,
  darkenColor,
  lightenColor,
  getContrastingColor,
} from '@eigenpal/docx-js-editor';

resolveColor({ type: 'theme', value: 'accent1' }, theme); // '#4472C4' (resolved hex)
resolveColor({ type: 'rgb', value: 'FF0000' }); // '#FF0000'
createThemeColor('accent1', 0.5); // Color object with tint
createRgbColor('FF0000'); // { type: 'rgb', value: 'FF0000' }
darkenColor('#4472C4', 20); // Darken by 20%
lightenColor('#4472C4', 20); // Lighten by 20%
getContrastingColor('#4472C4'); // 'white' or 'black'
```

### Font Loading

```ts
import {
  loadFont,
  loadFonts,
  preloadCommonFonts,
  isFontLoaded,
  onFontsLoaded,
} from '@eigenpal/docx-js-editor';

await loadFont('Calibri', '/fonts/Calibri.ttf');
await loadFonts([
  { name: 'Calibri', url: '/fonts/Calibri.ttf' },
  { name: 'Arial', url: '/fonts/Arial.ttf' },
]);
await preloadCommonFonts(); // Load common Office fonts
isFontLoaded('Calibri'); // boolean
onFontsLoaded(() => console.log('ready')); // Callback when all pending loads complete
```

### Insert Operations

```ts
import {
  createPageBreak,
  createPageBreakParagraph,
  insertPageBreak,
  createHorizontalRule,
} from '@eigenpal/docx-js-editor';

const pageBreak = createPageBreak(); // RunContent
const paragraph = createPageBreakParagraph(); // Full paragraph with page break
const newBody = insertPageBreak(body, 'after', 5); // Insert after paragraph 5
const hr = createHorizontalRule(); // Horizontal rule paragraph
```

---

## Framework Integration

### Next.js (App Router)

```tsx
'use client';

import dynamic from 'next/dynamic';

const DocxEditor = dynamic(() => import('@eigenpal/docx-js-editor').then((m) => m.DocxEditor), {
  ssr: false,
});

export default function EditorPage() {
  const [file, setFile] = useState<ArrayBuffer | null>(null);

  return (
    <div style={{ height: '100vh' }}>
      <input
        type="file"
        accept=".docx"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setFile(await f.arrayBuffer());
        }}
      />
      {file && <DocxEditor documentBuffer={file} />}
    </div>
  );
}
```

### Remix

```tsx
import { ClientOnly } from 'remix-utils/client-only';

export default function Editor() {
  return (
    <ClientOnly fallback={<p>Loading editor...</p>}>
      {() => {
        const { DocxEditor } = require('@eigenpal/docx-js-editor');
        return <DocxEditor documentBuffer={file} />;
      }}
    </ClientOnly>
  );
}
```

### Vue (via renderAsync)

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

### Vanilla JS

```html
<div id="editor" style="height: 100vh"></div>
<script type="module">
  import { renderAsync } from '@eigenpal/docx-js-editor';
  import '@eigenpal/docx-js-editor/styles.css';

  const buffer = await fetch('/template.docx').then((r) => r.arrayBuffer());
  const handle = await renderAsync(buffer, document.getElementById('editor'));
</script>
```

---

## Common Patterns and Recipes

### Load, Edit, and Save a DOCX

```ts
import { DocumentAgent } from '@eigenpal/docx-js-editor/headless';
import { readFile, writeFile } from 'fs/promises';

const buffer = await readFile('input.docx');
const agent = await DocumentAgent.fromBuffer(buffer.buffer);

const result = await agent
  .insertText({ paragraphIndex: 0, offset: 0 }, 'CONFIDENTIAL: ')
  .applyFormatting(
    { start: { paragraphIndex: 0, offset: 0 }, end: { paragraphIndex: 0, offset: 14 } },
    { bold: true, color: { type: 'rgb', value: 'FF0000' } }
  )
  .toBuffer();

await writeFile('output.docx', Buffer.from(result));
```

### Fill a Template and Download

```ts
import { processTemplate } from '@eigenpal/docx-js-editor';

const templateBuffer = await fetch('/invoice-template.docx').then((r) => r.arrayBuffer());
const filled = processTemplate(templateBuffer, {
  invoiceNumber: 'INV-2025-001',
  clientName: 'Acme Corp',
  amount: '$1,234.56',
  date: 'January 15, 2025',
});

// Download
const blob = new Blob([filled], {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'invoice.docx';
a.click();
URL.revokeObjectURL(url);
```

### Build AI Context from a Document

```ts
import { parseDocx, getAgentContext, buildSelectionContext } from '@eigenpal/docx-js-editor';

const doc = await parseDocx(buffer);
const context = getAgentContext(doc, {
  outlineMaxChars: 150,
  maxOutlineParagraphs: 100,
  includeFormatting: true,
});

// Feed to LLM
const prompt = `Here is the document context:\n${JSON.stringify(context, null, 2)}\n\nPlease summarize this document.`;
```

### Read-Only Document Viewer

```tsx
<DocxEditor documentBuffer={file} readOnly />
```

### Editor with Custom Toolbar Items

```tsx
<DocxEditor
  documentBuffer={file}
  toolbarExtra={<button onClick={() => editorRef.current?.print()}>Export PDF</button>}
/>
```

### Plugin with Overlay Tooltip

```tsx
const tooltipPlugin: EditorPlugin<{ pos: number | null }> = {
  id: 'tooltip',
  name: 'Tooltip',

  onStateChange(view) {
    const { from } = view.state.selection;
    return { pos: from };
  },

  renderOverlay(context, state) {
    if (!state?.pos) return null;
    const coords = context.getCoordinatesForPosition(state.pos);
    if (!coords) return null;

    return (
      <div
        style={{
          position: 'absolute',
          left: coords.x,
          top: coords.y + coords.height + 4,
          background: '#333',
          color: '#fff',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Cursor at position {state.pos}
      </div>
    );
  },
};
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

### Fonts not rendering correctly

Load fonts before rendering:

```ts
import { loadFonts } from '@eigenpal/docx-js-editor';
await loadFonts([{ name: 'Calibri', url: '/fonts/Calibri.woff2' }]);
```

### CSS conflicts with Tailwind

The editor's CSS is scoped under `.ep-root`. If your app's Tailwind styles leak in, ensure the editor container has the `ep-root` class (applied automatically by `DocxEditor`).

### Template variables not replaced

- Ensure variable names match exactly (case-sensitive)
- Check for split runs in Word: sometimes `{name}` is stored as `{`, `name`, `}` across multiple XML runs. Use `getTemplateTags()` to verify what the parser sees
- Use `validateTemplate()` to check for syntax errors

### Large documents slow to render

- The editor renders all pages. For very large documents (50+ pages), consider:
  - Using `readOnly` mode for preview
  - Reducing `initialZoom` to render fewer pixels
  - Using the headless API for programmatic operations

---

## Links

- [npm package](https://www.npmjs.com/package/@eigenpal/docx-js-editor)
- [GitHub repository](https://github.com/eigenpal/docx-editor)
- [Live demo](https://docx-js-editor.vercel.app/)
- [Props & Ref Methods](docs/PROPS.md)
- [Plugin System](docs/PLUGINS.md)
- [Architecture](docs/ARCHITECTURE.md)
