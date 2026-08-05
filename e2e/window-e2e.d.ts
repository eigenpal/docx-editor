import type { DocxEditorE2EHook } from '../examples/vite/src/test-harness/table-editing-e2e-hook.ts';

declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: DocxEditorE2EHook;
  }
}

export {};
