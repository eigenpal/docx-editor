---
'@eigenpal/docx-editor-react': minor
---

Add a `showHelpMenu` prop to `<DocxEditor>` (default `true`) for hiding the Help menu in the menu bar. It is threaded through `ToolbarProps`, so the compound `<EditorToolbar.MenuBar />` API respects it too. Consumers that want File/Format/Insert without the Help menu can now pass `showHelpMenu={false}` instead of reaching for CSS overrides.
