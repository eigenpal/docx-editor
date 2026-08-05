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

## The root is the 80% path

```ts
import { createDocxEditor, loadFonts, WORD_DEFAULT_FONT } from '@docx-editor.dev/core';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core';
```

Create an editor, the `Editor` contract it implements, fonts, the chrome registry, and the
document model types. Reach for a subpath when you need the canonical tree, the layout pass,
or the paint step directly.

| Subpath                | What's there                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `.`                    | Create an editor, the contract, fonts, the chrome registry, the document model. |
| `./editor`             | Everything the root re-exports, plus the paginated surface and ruler geometry.  |
| `./contracts/editor`   | `Editor`, `EditorCommand`, `EditorQuery`, `EditorSnapshot`, `PageSetup`.        |
| `./contracts/document` | The document-level edit and query vocabulary.                                   |
| `./contracts/types`    | Document model types.                                                           |
| `./contracts/modules`  | `EditorModule` — the shape `@docx-editor.dev/pro` implements.                   |
| `./store`              | The canonical tree and its transactional store.                                 |
| `./layout`             | The DOM-free layout pass.                                                       |
| `./output`             | Serialization.                                                                  |
| `./automation`         | The object model behind `@docx-editor.dev/editor-api`.                          |
| `./styles/editor.css`  | The one editor stylesheet, shared by packaged and custom chrome.                |

## Nothing is lost

Everything you do not edit comes back byte for byte, including parts the engine does not
model — custom XML, embedded fonts, macros, media, unknown extensions. Two oracles gate it in
CI: a canonical fingerprint over the tree, and a save-and-reopen semantic digest.

## One pipeline

```
bytes → bounded OPC/XML read → canonical OOXML tree → layout → painted pages → serialize
```

There is one document model. The painted pages are the editable surface: they are
`contenteditable`, but the DOM is a picture. Browser mutations are prevented and re-expressed
as tree operations, so the browser never invents markup inside your document.

Nodes are **typed** where layout needs them and **generic** everywhere else, preserving the
element verbatim. So content the engine does not model is carried rather than dropped, and a
document full of unknown extensions still opens, edits, and saves.

On save, modeled parts are re-emitted normalized; everything else — custom XML, embedded fonts,
media — is repacked from the original file untouched. Two oracles gate that in CI: a canonical
fingerprint over the tree, and a save-and-reopen semantic digest.

## Untrusted input

A `.docx` is a zip of XML that whoever sent it controls end to end. The engine sanitizes at the
parse boundary — URL allowlisting, entity and zip-bomb limits, recursion and element caps, no
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
