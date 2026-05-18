---
'@eigenpal/docx-editor-react': patch
---

vue: internal source restructure for React parity — `DocxEditorVue.vue` → `DocxEditor.vue`, root-level `docx-editor-props.ts` / `editor-mode.ts` / `editor-ref.ts` consolidated into `components/DocxEditor/types.ts`, orchestration files nested under `components/DocxEditor/`. No public API change.
