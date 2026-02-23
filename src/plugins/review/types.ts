import type { Document } from '../../types/document';

export type ReviewRevisionType = 'insertion' | 'deletion' | 'moveFrom' | 'moveTo' | 'formatChange';

export type ReviewRevisionStatus = 'supported' | 'unsupported';

export type ReviewRevisionLocation = 'body' | 'header' | 'footer';
export type ReviewHeaderFooterReferenceType = 'default' | 'first' | 'even';
export type ReviewRevisionApplyTarget = 'pm' | 'documentModel';
export type ReviewSourceParagraphChangeKind =
  | 'paragraphProperties'
  | 'paragraphMarkMoveFrom'
  | 'paragraphMarkMoveTo';

export interface ReviewRevisionItem {
  /** Stable UI identifier for this extracted revision segment. */
  id: string;
  /** Tracked-change class represented by the mark. */
  type: ReviewRevisionType;
  /** ProseMirror position range covered by this revision. */
  from: number;
  /** ProseMirror position range covered by this revision (exclusive). */
  to: number;
  /** User-facing short preview for sidebar display. */
  textPreview: string;
  /** Word revision id (`w:id`) when available. */
  revisionId: number;
  /** Revision author as encoded in the mark attributes. */
  author: string;
  /** Revision timestamp in ISO format when available. */
  date: string | null;
  /** Move range id when available (`w:move*Range* w:id`). */
  rangeId: number | null;
  /** Optional move range metadata. */
  rangeName: string | null;
  rangeAuthor: string | null;
  rangeDate: string | null;
  /** Whether this revision can be safely actioned in-app. */
  status: ReviewRevisionStatus;
  /** Optional explanation for unsupported revisions. */
  reason: string | null;
  /** Peer revision id for move pairs (moveFrom <-> moveTo). */
  pairId: string | null;
  /** Where this revision originated in the DOCX package. */
  location: ReviewRevisionLocation;
  /**
   * Page hint used for non-body revisions (header/footer) when no PM range
   * exists to map them via body spans.
   */
  anchorPageNumber: number | null;
  /** Header/footer reference type for non-body revisions, if known. */
  headerFooterRefType: ReviewHeaderFooterReferenceType | null;
  /** Header/footer relationship id for non-body revisions, if known. */
  sourceRelationshipId: string | null;
  /** Sequential tracked-change index within the source header/footer part. */
  sourceChangeIndex: number | null;
  /** How the revision should be applied when accepted/rejected. */
  applyTarget: ReviewRevisionApplyTarget;
  /** Source paragraph id for body revisions driven by document-model metadata. */
  sourceParagraphId: string | null;
  /** Paragraph-level change kind when applyTarget=documentModel. */
  sourceParagraphChangeKind: ReviewSourceParagraphChangeKind | null;
  /** Sequential index of paragraph-level change within the paragraph. */
  sourceParagraphChangeIndex: number | null;
}

export interface ReviewPluginState {
  revisions: ReviewRevisionItem[];
  activeRevisionId: string | null;
  totalCount: number;
  supportedCount: number;
  unsupportedCount: number;
  /**
   * Host callback for applying document-model mutations outside the PM body.
   * Used by header/footer revision accept/reject actions.
   */
  mutateDocumentModel?: (updater: (document: Document) => Document | null) => boolean;
}

export type ReviewDecision = 'accept' | 'reject';
