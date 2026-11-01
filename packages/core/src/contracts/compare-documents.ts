/** What one compare request carries: the revised DOCX and its options. @public */
export interface CompareDocumentsRequest {
  /** The revised document's DOCX bytes. The open document is the original. */
  readonly revised: Uint8Array;
  /** Author recorded on every revision. The editor's author when absent. */
  readonly authorName?: string;
  /** Record formatting differences as formatting revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
}

/** The outcome of one compare. @public */
export type CompareDocumentsOutcome =
  | { readonly ok: true; readonly revisionCount: number }
  | { readonly ok: false; readonly message: string };

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
   * tracked changes, as one undoable step. Closes the session on success. A refusal leaves it
   * open with a message to show.
   */
  apply(request: CompareDocumentsRequest): Promise<CompareDocumentsOutcome>;
  /** Close without comparing. */
  cancel(): void;
}

/** Host rendering for the Compare documents dialog. @public */
export interface CompareDocumentsChromeHandlers {
  readonly onRequest?: (session: CompareDocumentsDialogSession) => void;
}
