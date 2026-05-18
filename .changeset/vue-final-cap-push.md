---
'@eigenpal/docx-editor-react': patch
---

Internal: `DocxEditorVue.vue` now under the 1000-LOC cap (897). Split template into `DocxEditorMenuBar`, `DocxEditorDialogs`, `DocxEditorOverlays`; extracted `useMenuActions`, `useCommentLifecycle`, `useDocumentLifecycle` composables; moved styles to a co-located `.css` file. No public-API change.
