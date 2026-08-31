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

The engine behind [docx-editor.dev](https://docx-editor.dev). It reads a `.docx` into a
canonical document tree, lays that tree out into pages, paints them, and writes the tree back
to OOXML. No framework dependency and no UI.

Most apps never install this directly — [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)
carries it. Reach for it when you are writing your own adapter, or when you need the contract
types to write a function signature.

```bash
npm install @docx-editor.dev/core
```

Node use requires `^20.16.0 || >=22.3.0`.

## Entry points

```ts
import { createDocxEditor, loadFonts, WORD_DEFAULT_FONT } from '@docx-editor.dev/core';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core';
```

The root covers most uses: creating an editor, the `Editor` contract it implements, fonts,
the chrome registry, and the document model types. Subpaths expose the canonical tree, the
layout pass, and the paint step directly.

| Subpath                       | What's there                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `.`                           | Create an editor, the contract, fonts, the chrome registry, the document model.              |
| `./editor`                    | Everything the root re-exports, plus the paginated surface and ruler geometry.               |
| `./contracts/editor`          | `Editor`, `EditorCommand`, `EditorQuery`, `EditorSnapshot`, `PageSetup`.                     |
| `./contracts/document`        | The document-level edit and query vocabulary.                                                |
| `./contracts/interaction`     | Semantic addressing (`SemanticTarget`) and the `InteractionOutcome` an attempt answers with. |
| `./contracts/types`           | Document model types.                                                                        |
| `./contracts/modules`         | `EditorModule` — the shape `@docx-editor.dev/pro` implements.                                |
| `./store`                     | The canonical tree and its transactional store.                                              |
| `./layout`                    | The DOM-free layout pass.                                                                    |
| `./output`                    | Serialization.                                                                               |
| `./export`                    | Reusable, DOM-free semantic layout sessions for Markdown, PDF, and future exporters.         |
| `./automation`                | The object model behind `@docx-editor.dev/editor-api`.                                       |
| `./collaboration`             | Provider-neutral collaboration session contracts.                                            |
| `./collaboration/replication` | Replication helpers for collaboration providers.                                             |
| `./styles/editor.css`         | The one editor stylesheet, shared by packaged and custom chrome.                             |

## Architecture

```
bytes → bounded OPC/XML read → canonical OOXML tree → layout → painted pages → serialize
```

There is one document model. The painted pages are the editable surface: they are
`contenteditable`, but the DOM is a picture. Browser mutations are prevented and re-expressed
as tree operations, so the browser never invents markup inside your document.

Nodes are typed where layout needs them and generic everywhere else, preserving the element
verbatim. Content the engine does not model is carried rather than dropped, so a document full
of unknown extensions still opens, edits, and saves.

Export sessions use the editor's reader-safe revision view by default: `all-markup` keeps both
halves of pending tracked changes visible. Pass `displayMode: 'proposed'` or
`displayMode: 'original'` explicitly when the exporter should present a resolved view instead.

## Fidelity

Untouched content, unsupported OOXML, and package payloads survive editing and save. The
canonical tree preserves document structure while embedded fonts, macros, media, and other
payloads pass through untouched. Two oracles gate this in CI: a canonical fingerprint over the
tree, and a save-and-reopen semantic digest.

## Untrusted input

A `.docx` is a zip of XML that whoever sent it controls end to end. The engine sanitizes at the
parse boundary: URL allowlisting, entity and zip-bomb limits, recursion and element caps, no
zero-click external fetches, escaping on the way back out.

Anything you render from document data (a font name, a hyperlink target, a comment body) is
still attacker-controlled at your boundary. Render it as text; do not build markup or URLs
from it.

## Documentation

- [Core overview](https://www.docx-editor.dev/docs/2.x/core)
- [Architecture](https://www.docx-editor.dev/docs/2.x/core/architecture)
- [Word fidelity](https://www.docx-editor.dev/docs/2.x/word-fidelity)

## License

Apache-2.0
