/** Playwright-only hooks on the Vite demo (not a public API). */
declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: {
      getPmStartForParaId: (paraId: string) => number | null;
      getSelectionAnchor: () => number | null;
      getTextblockEndForParaId: (paraId: string) => number | null;
      getFirstTextblockParaId: () => string | null;
      getLastTextblockParaId: () => string | null;
      scrollToParaId: (paraId: string) => boolean;
      scrollToPosition: (pmPos: number) => void;
      scrollToPage: (pageNumber: number) => void;
      getTotalPages: () => number;
      getCurrentPage: () => number;
      // Agent bridge surface
      agentAddComment: (opts: {
        paraId: string;
        text: string;
        author?: string;
        search?: string;
      }) => number | null;
      agentProposeChange: (opts: {
        paraId: string;
        search: string;
        replaceWith: string;
        author?: string;
      }) => boolean;
      agentReplyComment: (commentId: number, text: string, author?: string) => number | null;
      agentResolveComment: (commentId: number) => void;
      agentFind: (query: string) => Array<{
        paraId: string;
        match: string;
        before: string;
        after: string;
      }>;
      agentSelection: () => {
        paraId: string | null;
        selectedText: string;
        paragraphText: string;
        before: string;
        after: string;
      } | null;
      agentGetCommentCount: () => number;
      agentOnContentChangeCount: number;
      agentOnSelectionChangeCount: number;
      agentSubscribeContentChange: () => () => void;
      agentSubscribeSelectionChange: () => () => void;
      agentApplyFormatting: (opts: {
        paraId: string;
        search?: string;
        marks: {
          bold?: boolean;
          italic?: boolean;
          underline?: boolean | { style?: string };
          strike?: boolean;
          color?: { rgb?: string; themeColor?: string };
          highlight?: string;
          fontSize?: number;
          fontFamily?: { ascii?: string; hAnsi?: string };
        };
      }) => boolean;
      agentSetParagraphStyle: (opts: { paraId: string; styleId: string }) => boolean;
      agentGetPageContent: (pageNumber: number) => {
        pageNumber: number;
        text: string;
        paragraphs: Array<{ paraId: string; text: string; styleId?: string }>;
      } | null;
    };
  }
}

export {};
