---
'@docx-editor.dev/react': minor
---

Add a document navigation pane with Headings and Find tabs (`DocxEditor.Navigation`), plus the `useNavigationPane`, `useDocumentOutline` and `useDocumentSearch` hooks behind it. Find is now implemented in the engine: `Editor.findMatches` and `Editor.selectMatch` return real results instead of empty stubs, and matches carry surrounding text so a results list can show them in context.

The open pane no longer pushes the document sideways when there is already room for it in the left gutter — it moves the page only when the window is too narrow, and only as far as it needs.
