---
'@docx-editor.dev/react': major
'@docx-editor.dev/core': major
---

Initial release.

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
