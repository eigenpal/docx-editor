---
'@docx-editor.dev/react': minor
---

Comments and tracked changes move to the commercial `@docx-editor.dev/pro` package. The free editor still opens, edits, and saves documents containing tracked changes and comments losslessly; it renders them in their final state and reports `hasReviewContent` so a host can say the document holds more. Registering `reviewModule()` from `@docx-editor.dev/pro` restores markup rendering, the review pane (`DocxEditorReview` now imports from `@docx-editor.dev/pro/react`), suggesting mode, and accept/reject/reply. `createDocxEditor` and `DocxEditor.Root` accept the new `modules` option; `@docx-editor.dev/pro` also ships `defineCustomNode` for custom inline nodes anchored on content controls.
