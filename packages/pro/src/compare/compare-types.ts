/** Public types of the document compare engine. */

/** Options for {@link compareDocuments}. @public */
export interface CompareDocumentsOptions {
  /**
   * Author recorded on every revision. Defaults to the revised document's last author
   * (`cp:lastModifiedBy`, then `dc:creator`), else `Comparison`.
   */
  readonly authorName?: string;
  /** Record formatting differences as property-change revisions. Default `true`. */
  readonly detectFormatChanges?: boolean;
  /** Omit `w:date` from the revisions. Default `false`. */
  readonly removeDateAndTime?: boolean;
  /** Revision timestamp. Defaults to the current time, truncated to the minute. */
  readonly date?: Date;
}

/** Why a compare was refused. @public */
export type CompareDocumentsErrorCode =
  /** One of the inputs is not a readable DOCX package. */
  | 'invalid-original'
  | 'invalid-revised'
  /** The inputs exceed the engine's size limits. */
  | 'too-large'
  /** The engine could not produce a result that reproduces both inputs. */
  | 'unsupported-content';

/** Result of {@link compareDocuments}. @public */
export type CompareDocumentsResult =
  | {
      readonly ok: true;
      /** The original document with the differences recorded as tracked changes. */
      readonly bytes: Uint8Array;
      /** Number of revision elements written. */
      readonly revisionCount: number;
    }
  | {
      readonly ok: false;
      readonly code: CompareDocumentsErrorCode;
      readonly message: string;
    };
