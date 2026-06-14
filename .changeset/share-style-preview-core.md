---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-vue': patch
---

Share the paragraph-style-picker preview logic between the React and Vue toolbars. The filter/sort and per-style preview CSS now live once in `@eigenpal/docx-editor-core/utils/stylePreview` (`resolveParagraphStyleOptions` + `getStylePreviewProps`), which both adapters call, so the style dropdown can no longer drift between them. Also fixes a Vue toolbar bug where typing a font size and then clicking a preset could re-commit the typed value over the preset.
