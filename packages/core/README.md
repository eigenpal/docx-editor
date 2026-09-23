<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/v/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/core

Use the [docx-editor.dev](https://docx-editor.dev) engine to read, edit, render, and save DOCX files. The engine stores document content in a canonical tree. It has no framework dependency.

Install this package alongside the React or Vue adapter. Both adapters require it as a peer dependency. You can also use its public contracts to build your own adapter.

```bash
npm install @docx-editor.dev/core
```

Node.js requires `^20.16.0 || >=22.3.0`.

## Entry points

Import editor creation, font helpers, and contract types from the package root:

```ts
import { createDocxEditor, loadFonts, WORD_DEFAULT_FONT } from '@docx-editor.dev/core';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core';
```

The root exports editor creation, contracts, font helpers, control definitions, and document types. Use subpaths to access storage, layout, and rendering.

| Subpath | Exports |
| --- | --- |
| `.` | Create an editor, the contract, fonts, the chrome registry, the document model. |
| `./editor` | Everything the root re-exports, plus the paginated surface and ruler geometry. |
| `./contracts/editor` | `Editor`, `EditorCommand`, `EditorQuery`, `EditorSnapshot`, `PageSetup`. |
| `./contracts/document` | The document-level edit and query vocabulary. |
| `./contracts/interaction` | Semantic addressing (`SemanticTarget`) and the `InteractionOutcome` an attempt answers with. |
| `./contracts/types` | Document model types. |
| `./contracts/modules` | `EditorModule` — the shape `@docx-editor.dev/pro` implements. |
| `./store` | The canonical tree and its transactional store. |
| `./layout` | The DOM-free layout pass. |
| `./output` | Paint layouts and selection overlays into the DOM. |
| `./export` | Document layout sessions for exporters. No DOM required. |
| `./automation` | The object model behind `@docx-editor.dev/editor-api`. |
| `./collaboration` | Provider-neutral collaboration session contracts. |
| `./collaboration/replication` | Replication helpers for collaboration providers. |
| `./styles/editor.css` | The one editor stylesheet, shared by packaged and custom chrome. |

## Architecture

The engine reads DOCX bytes into a canonical OOXML tree. Layout reads the tree and produces painted pages. Saving serializes the tree back into a DOCX package.

The document tree holds all editing state. The engine displays editable pages and converts browser input into tree operations.

Typed nodes supply layout properties. Generic nodes preserve other element structures, including unsupported extensions.

Export sessions default to `all-markup`, which shows inserted and deleted text. Use `displayMode: 'proposed'` for the accepted view or `displayMode: 'original'` for the rejected view.

### Build a paginated exporter

For exports that need font-based page breaks, use `openFontBackedDocumentForExport`. It resolves the fonts used throughout the document before layout. Without a measurer, `openDocumentForExport(bytes)` uses a fixed-width approximation.

Install `@docx-editor.dev/fonts` to use packaged substitutes in this example:

```ts
import { readFile } from 'node:fs/promises';
import { openFontBackedDocumentForExport } from '@docx-editor.dev/core/export';
import { packagedFonts } from '@docx-editor.dev/fonts';

const bytes = new Uint8Array(await readFile('contract.docx'));
const opened = await openFontBackedDocumentForExport(bytes, {
  fonts: packagedFonts(),
  fontPolicy: 'strict',
  onFontResolution: (report) => console.info(report),
});

if (!opened.ok) throw new Error(`DOCX rejected: ${opened.reason}`);
try {
  const layout = await opened.session.layout();
  console.log(layout); // Replace this with your exporter.
} finally {
  opened.session.dispose(); // releases document-owned shaping bytes
}
```

Let the engine manage fonts, resources, and layout. Build your output from the returned pages. For a live `HeadlessDocumentView`, pass the editor's revision-stable measurer.

## Fidelity

Untouched content, unsupported OOXML, and package payloads survive editing and save. The canonical tree preserves document structure while embedded fonts, macros, media, and other payloads pass through untouched. Two oracles gate this in CI: a canonical fingerprint over the tree, and a save-and-reopen semantic digest.

## Untrusted input

Treat DOCX files as untrusted input. The engine validates URLs and limits XML entities, archive expansion, nesting, and element counts. It does not automatically fetch external document relationships. Serialization escapes document text.

Anything you render from document data (a font name, a hyperlink target, a comment body) is still attacker-controlled at your boundary. Render it as text; do not build markup or URLs from it.

## Documentation

- [Core overview](https://www.docx-editor.dev/docs/2.x/core)
- [Architecture](https://www.docx-editor.dev/docs/2.x/core/architecture)
- [Word fidelity](https://www.docx-editor.dev/docs/2.x/word-fidelity)

## License

Apache-2.0
