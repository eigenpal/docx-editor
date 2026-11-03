import type { CompareDocumentsErrorCode } from './document-compare.ts';

/**
 * The `accept` value for a file input that picks the revised document: DOCX files only.
 *
 * @public
 */
export const COMPARE_DOCUMENTS_ACCEPT =
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** What one compare request carries: the revised DOCX and its options. @public */
export interface CompareDocumentsRequest {
  /** The revised document's DOCX bytes. The open document is the original. */
  readonly revised: Uint8Array;
  /**
   * Author recorded on every revision. The editor's author when absent, empty, or only white
   * space, else the revised document's last author.
   */
  readonly authorName?: string;
  /** Record formatting differences as formatting revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Write the revisions without dates. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/** The outcome of one compare. @public */
export type CompareDocumentsOutcome =
  | {
      readonly ok: true;
      /**
       * Tracked changes recorded, one per review decision: the items that `revisions`
       * collections and the review pane list, summed over the body, headers, footers, and
       * notes. A replaced word counts its deletion and its insertion.
       */
      readonly revisionCount: number;
      /**
       * Whether the document changed. False when the documents have no differences: the
       * document, its undo history, and its saved state stay as they were.
       */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      /** Why the compare was refused. `compareDocuments.errors.<code>` translates it. */
      readonly code: CompareDocumentsErrorCode;
      /** Diagnostic detail, in English; not for display. */
      readonly message: string;
    };

/**
 * One open Compare documents dialog. The editor owns it: the session aborts when the dialog
 * closes, is replaced, or the document, mount, or editor goes away.
 *
 * @public
 */
export interface CompareDocumentsDialogSession {
  /** Aborts on close, replacement, load, detach, or destroy. */
  readonly signal: AbortSignal;
  /** The author name the dialog offers first: the editor's author, or an empty string. */
  readonly defaultAuthor: string;
  /** Whether a compare can run now. */
  canApply(): boolean;
  /**
   * Compare the open document with the revised DOCX and record the differences in it as
   * tracked changes, as one undoable step. Closes the session when the document changes. With
   * no differences (`changed` false) or a refusal, the session stays open with a message to
   * show.
   */
  apply(request: CompareDocumentsRequest): Promise<CompareDocumentsOutcome>;
  /** Close without comparing. */
  cancel(): void;
}

/** Host rendering for the Compare documents dialog. @public */
export interface CompareDocumentsChromeHandlers {
  readonly onRequest?: (session: CompareDocumentsDialogSession) => void;
}
