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
  /** Author recorded on every revision. The editor's author when absent. */
  readonly authorName?: string;
  /** Record formatting differences as formatting revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Write the revisions without dates. Default `false`. */
  readonly removeDateAndTime?: boolean;
}

/**
 * Why a compare was refused, as a stable code a dialog translates: the engine's refusals of the
 * documents (`invalidOriginal`, `invalidRevised`, `tooLarge`, `unsupportedContent`), and the
 * editor's (`unavailable`: no review module, document, or mount; `protected`; `collaboration`;
 * `viewing`; `closed`: the dialog was closed; `empty`: no revised bytes; `failed`: anything
 * else).
 *
 * @public
 */
export type CompareDocumentsRefusal =
  | 'invalidOriginal'
  | 'invalidRevised'
  | 'tooLarge'
  | 'unsupportedContent'
  | 'unavailable'
  | 'protected'
  | 'collaboration'
  | 'viewing'
  | 'closed'
  | 'empty'
  | 'failed';

/** The outcome of one compare. @public */
export type CompareDocumentsOutcome =
  | { readonly ok: true; readonly revisionCount: number }
  | {
      readonly ok: false;
      /** What to tell the user, as a code to translate. */
      readonly reason: CompareDocumentsRefusal;
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
   * tracked changes, as one undoable step. Closes the session when it records changes. With no
   * differences (`revisionCount` 0) or a refusal, the session stays open with a message to show.
   */
  apply(request: CompareDocumentsRequest): Promise<CompareDocumentsOutcome>;
  /** Close without comparing. */
  cancel(): void;
}

/** Host rendering for the Compare documents dialog. @public */
export interface CompareDocumentsChromeHandlers {
  readonly onRequest?: (session: CompareDocumentsDialogSession) => void;
}
