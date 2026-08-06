# @docx-editor.dev/core

## 2.0.1

### Patch Changes

- 51f14f5: Add the `repository` field to the core package manifest so npm can verify its provenance statement on publish.
  - @docx-editor.dev/i18n@2.0.1

## 2.0.0

### Major Changes

- 26095c6: Initial release.

  A WYSIWYG `.docx` editor that runs entirely in the browser: it opens a Word file, paints
  the real paginated layout, edits it in place, and writes a `.docx` back out.
  - `@docx-editor.dev/react` — the React adapter. `<DocxEditor document={bytes} />` for the
    packaged editor, or compose `DocxEditor.Root` / `.Viewport` / `.Content` with the hooks
    (`useEditorState`, `useEditorCommand`, `useDocxEditor`) to build your own chrome.
  - `@docx-editor.dev/core` — the framework-agnostic engine: OPC/XML reading, the canonical
    OOXML tree, layout, paint, and the `Editor` contract the adapters render.
  - `@docx-editor.dev/i18n` — the shared string catalogue, with nine locales.
  - `@docx-editor.dev/editor-api` — a batching document object model for automating a
    document from a server or from an editor already open in a page.
  - `@docx-editor.dev/pro` — tracked changes, comments, and custom nodes.

  Word fidelity is structural: styles, theme colours, tables, headers and footers, section
  layout, numbering, and tab stops resolve through the same cascade Word uses, and content
  the editor does not model round-trips untouched.

- 26095c6: `setSelection` now types the forms it actually accepts. `EditorSelection` gained the
  `{ anchor, head }` paragraph-id pair the engine honours, and lost the `SemanticTarget` and
  `DocLocation` arms it never accepted, so the outline and any other caller can move the caret
  without a cast.

  Breaking if you passed a `SemanticTarget` or a `DocLocation`-ended range to `setSelection`:
  both were refused at runtime with `unsupported`, so working code is unaffected.

- 26095c6: Remove `EditorHost`, `EditorConfig` and `createEditor` from the public surface. They described a retired pipeline in which the adapter supplied DOM handles and a display sink; the editor has painted its own surface since `createDocxEditor` replaced it, and none of the three had a caller. Use `createDocxEditor` with `DocxEditorConfig`.

### Minor Changes

- 26095c6: Put the caret in the right place on an empty paragraph. A centred or right-aligned one drew it at the left margin, and one with a first-line indent ignored the indent; in both cases it only jumped to the correct position once a character was typed. Lines now publish their aligned content origin as `LineRecord.contentX`.
- 26095c6: The root entry and the `contracts/*` entries now export the types their own signatures hand
  out — `CanResult` from `can()`, `TextMatch` from `findText()`, `TableContext` from `query()`
  and around 60 more that were previously unnameable from the entry point that returns them.
  The root re-exports the whole `Editor` contract rather than a hand-listed subset, so it cannot
  drift from it again.

  Removes `@docx-editor.dev/core/contracts/plugin` and `@docx-editor.dev/core/contracts/mcp`.
  Every function in them threw, and `coreTools` had no runtime binding at all. Extensions and
  MCP are deferred to a separately specified contract; `EditorModule` is the supported seam.

### Patch Changes

- Updated dependencies [26095c6]
  - @docx-editor.dev/i18n@2.0.0
