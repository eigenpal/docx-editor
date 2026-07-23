// The framework-independent editing session moved into the production engine (document-engine 4.1):
// it now lives in @docx-editor.dev/engine-binding beside the EditorBinding it drives. This file is a
// thin re-export so the example editable components keep their import path.
export { type ApplyResult, type DocxEditorSession, openDocxSession } from '@docx-editor.dev/engine-binding';
