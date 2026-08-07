---
'@docx-editor.dev/react': patch
---

Under the packaged `<DocxEditor>`, `.docx-editor` is now on the editor root and nowhere else. The toolbar, menu bar, navigation pane, context menu, viewport and page-number chip each added the class as their own Tailwind scope, which they only need when there is no scoped ancestor. A host rule like `.my-shell .docx-editor { height: 100% }` therefore also matched the toolbar. Composing from `DocxEditor.Root`, which renders no element, is unchanged: the parts still scope themselves.
