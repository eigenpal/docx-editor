import type { DocxEditorE2EHook } from '../examples/vite/src/test-harness/table-editing-e2e-hook.ts';
import type { ReviewWriteItemSnap } from '../examples/vite/src/ReviewWritesE2eBridge';

declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: DocxEditorE2EHook;
    __DOCX_REVIEW_E2E__?: {
      reviewItems(): ReviewWriteItemSnap[];
      saveBytes(): Promise<number[]>;
    };
  }
}

export {};
