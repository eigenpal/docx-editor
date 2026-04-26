/** Playwright-only hooks on the Vite demo (not a public API). */
declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: {
      getPmStartForParaId: (paraId: string) => number | null;
      getFirstTextblockParaId: () => string | null;
      getLastTextblockParaId: () => string | null;
      scrollToParaId: (paraId: string) => boolean;
      scrollToPosition: (pmPos: number) => void;
    };
  }
}

export {};
