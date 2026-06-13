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
      getDocSize: () => number | null;
      highlightRange: (from: number, to: number) => void;
      scrollToPage: (pageNumber: number) => void;
      getTotalPages: () => number;
      getCurrentPage: () => number;
      saveByteLength: () => Promise<number | null>;
      // Content-control (SDT) addressing surface
      agentGetContentControls: (filter?: {
        tag?: string;
        alias?: string;
        id?: number;
        type?: string;
      }) => Array<{ tag?: string; alias?: string; sdtType: string; text: string }>;
      agentSetContentControlContent: (
        filter: { tag?: string; alias?: string; id?: number },
        text: string,
        options?: { force?: boolean }
      ) => boolean;
      agentRemoveContentControl: (
        filter: { tag?: string; alias?: string; id?: number },
        options?: { force?: boolean; keepContent?: boolean }
      ) => boolean;
      agentScrollToContentControl: (filter: {
        tag?: string;
        alias?: string;
        id?: number;
      }) => boolean;
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
      agentGetDocumentText: () => string;
      // Tracked structural revisions (#614).
      setSuggestionMode: (active: boolean, authorOverride?: string) => boolean;
      getParagraphRevisionAt: (index: number) => {
        pPrIns: { revisionId: number; author: string; date: string | null } | null;
        pPrDel: { revisionId: number; author: string; date: string | null } | null;
      } | null;
      acceptChangeById: (revisionId: number) => boolean;
      rejectChangeById: (revisionId: number) => boolean;
      acceptAllChanges: () => boolean;
      rejectAllChanges: () => boolean;
      getParagraphAttrs: (index: number) => Record<string, unknown> | null;
      plantParagraphPropertyChange: (
        revisionId: number,
        prior: unknown,
        current?: unknown,
        paraAttrs?: Record<string, unknown>
      ) => boolean;
      insertTable: (rows: number, cols: number) => boolean;
      insertImage: (src: string, width?: number, height?: number) => boolean;
      selectFirstImage: () => boolean;
      plantSimpleTable: () => boolean;
      plantTableRowInsertion: (revisionId: number) => boolean;
      getFirstTableRowAttrs: () => Record<string, unknown> | null;
      countTableRows: () => number;
      focusFirstTableCell: () => boolean;
      addRowBelow: () => boolean;
      deleteCurrentRow: () => boolean;
    };
  }
}

export {};
