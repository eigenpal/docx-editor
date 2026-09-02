// Exporter-neutral review provenance published beside semantic page records.

/** Published root story containing an artifact occurrence. @public */
export type SemanticArtifactRootStoryKind =
  | 'body'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'note-separator';

/** Exact story in which a review artifact's source anchor was laid out. @public */
export type SemanticArtifactStoryKind = SemanticArtifactRootStoryKind | 'textbox';

/** One model position retained as exporter provenance. @public */
export interface SemanticReviewArtifactPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** Package-relative snapshot provenance, not durable public identity. @public */
export interface SemanticReviewArtifactSource {
  readonly partName: string;
  readonly start: SemanticReviewArtifactPosition;
  readonly end: SemanticReviewArtifactPosition;
}

/** Rectangle in page-content coordinates, the same space as line boxes. @public */
export interface SemanticReviewArtifactPageContentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Rectangle in stacked page coordinates. @public */
export interface SemanticReviewArtifactPageStackRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Laid-out bounds for one review occurrence. @public */
export interface SemanticReviewArtifactOccurrenceGeometry {
  readonly pageContent: readonly SemanticReviewArtifactPageContentRect[];
  readonly pageStack: readonly SemanticReviewArtifactPageStackRect[];
}

/** One physical occurrence of a comment or tracked-change source range. @public */
export interface SemanticReviewArtifactOccurrence {
  readonly pageIndex: number;
  readonly physicalPageNumber: number;
  readonly story: SemanticArtifactStoryKind;
  readonly rootStory: SemanticArtifactRootStoryKind;
  /** Root-to-leaf drawing ids for a textbox occurrence; empty outside textboxes. */
  readonly textboxPath: readonly string[];
  readonly noteScopeId: string | null;
  readonly noteAreaKind: 'footnotes' | 'endnotes' | null;
  /** Replacement-half meaning for tracked-change occurrences; absent for comments. */
  readonly revisionRole?: 'replaced' | 'replacement' | 'neutral';
  readonly source: SemanticReviewArtifactSource;
  /** Laid-out bounds when this occurrence can be measured; omitted otherwise. */
  readonly geometry?: SemanticReviewArtifactOccurrenceGeometry;
}

/** Normalized change; ids are opaque and stable only within the source snapshot. @public */
export interface SemanticTrackedChangeArtifactRecord {
  readonly kind: 'tracked-change';
  readonly id: string;
  readonly change:
    | 'insert'
    | 'delete'
    | 'replace'
    | 'moveFrom'
    | 'moveTo'
    | 'format'
    | 'paragraphMark'
    | 'structural';
  readonly markDirection?: 'insert' | 'delete' | 'moveFrom' | 'moveTo';
  readonly author: string;
  readonly date?: string;
  readonly text: string;
  readonly replacedText: string;
  /** Nested tracked-change depth, where the innermost decision is operative. */
  readonly nesting: number;
  /** Number of leading source ranges belonging to struck text in a replacement. */
  readonly replacedRangeCount?: number;
  readonly readOnly: boolean;
  readonly pairedWith?: string;
  readonly replyIds: readonly string[];
  readonly occurrences: readonly SemanticReviewArtifactOccurrence[];
}

/** Normalized comment; all relation ids share the opaque snapshot-local id space. @public */
export interface SemanticCommentArtifactRecord {
  readonly kind: 'comment';
  readonly id: string;
  readonly author: string;
  readonly initials: string;
  readonly date?: string;
  readonly text: string;
  readonly resolved: boolean;
  readonly parentId?: string;
  readonly parentRevisionId?: string;
  readonly replyIds: readonly string[];
  readonly orphaned: boolean;
  readonly occurrences: readonly SemanticReviewArtifactOccurrence[];
}

/** Exporter-neutral review artifact normalized by core. @public */
export type SemanticReviewArtifactRecord =
  | SemanticTrackedChangeArtifactRecord
  | SemanticCommentArtifactRecord;
