import type {
  AnchorHighlightAnimation,
  AnchorHighlightOptions,
  ClearAnchorHighlightOptions,
  ScrollToAnchorOptions,
} from '../contracts/editor.ts';

/** A processor location in the returned document's body, including table paragraphs. @public */
export interface RefreshLocation {
  /** OOXML w14:paraId. Use this or paragraphIndex, not both. */
  readonly paragraphId?: string;
  /** Zero-based body paragraph index in document order. */
  readonly paragraphIndex?: number;
  /** UTF-16 offsets in the returned paragraph. */
  readonly start: number;
  readonly end: number;
  /** Exact returned text at these offsets. Required to reject mismatched metadata. */
  readonly text: string;
}

/** One processor change. Keep its id stable across cumulative results. @public */
export interface RefreshChangeInput {
  readonly id: string;
  readonly location?: RefreshLocation;
  /** Deletions without a surviving range have no highlight. */
  readonly unavailableReason?: 'deleted' | 'unavailable';
}

/** One validated change for an accepted result. @public */
export interface RefreshChange {
  readonly id: string;
  /** Identity of the accepted submission and processor sequence. */
  readonly resultId: string;
  /** True for a new change id or changed text in an existing change id. */
  readonly isNew: boolean;
  readonly status: 'available' | 'deleted' | 'unavailable' | 'invalid' | 'unsupported-story';
  readonly location?: RefreshLocation;
}

/** A document captured for external processing. Treat this object as an opaque token. @public */
export interface RefreshSubmission {
  readonly id: string;
  readonly bytes: ArrayBuffer;
}

/** Cumulative output for one submission. Assign sequence at the processor, before delivery. @public */
export interface RefreshUpdate {
  readonly submission: RefreshSubmission;
  readonly sequence: number;
  readonly bytes: ArrayBuffer | Uint8Array;
  /** Omit to derive changes from tracked revisions when a review module is registered. */
  readonly changes?: readonly RefreshChangeInput[];
  /** Stable failed operation ids. The controller reports these and never retries processor work. */
  readonly failures?: readonly string[];
}

/** Stable refusal codes for external document replacement. @public */
export type RefreshFailureCode =
  | 'unavailable'
  | 'collaboration'
  | 'busy'
  | 'cancelled'
  | 'superseded'
  | 'document-changed'
  | 'local-edits'
  | 'out-of-order'
  | 'invalid-result'
  | 'invalid-document'
  | 'input-failed'
  | 'load-failed'
  | 'recovery-failed';

/** Completion belongs to one result, including refusals and recovery failures. @public */
export type RefreshResult =
  | {
      readonly ok: true;
      readonly resultId: string;
      readonly changes: readonly RefreshChange[];
      readonly changeInformation: 'available' | 'unavailable';
      readonly failures: readonly string[];
    }
  | {
      readonly ok: false;
      readonly resultId: string;
      readonly code: RefreshFailureCode;
      readonly recovered?: boolean;
    };

/** Observable controller state. Document editing stays available during processing. @public */
export interface DocumentRefreshState {
  readonly phase:
    | 'idle'
    | 'capturing'
    | 'processing'
    | 'refreshing'
    | 'recovering'
    | 'complete'
    | 'failed';
  readonly result: RefreshResult | null;
  readonly changes: readonly RefreshChange[];
  /** Whether highlights are requested for available locations. False when the whole set starts dismissal. */
  readonly highlightsVisible: boolean;
  /** Offer restore and download controls when true. */
  readonly recoveryAvailable: boolean;
}

/** Opacity fade settings. Reduced motion caps fades at 125ms. @public */
export type RefreshHighlightAnimation = AnchorHighlightAnimation;

/** Presentation for temporary paragraph highlights. Each call starts from these defaults. @public */
export interface RefreshHighlightOptions extends AnchorHighlightOptions {
  /** Include earlier changes from the latest cumulative result. Default: false. */
  readonly includePrevious?: boolean;
  /** Select these change IDs instead of the recent/all filter. Unknown or unavailable IDs are skipped. Empty means none. */
  readonly changeIds?: readonly string[];
}

/** Explicit highlight dismissal. Document edits always remove stale highlights immediately. @public */
export type ClearRefreshHighlightsOptions = ClearAnchorHighlightOptions;

/** Explicit change navigation. Does not change the default scroll preservation during refresh. @public */
export interface NavigateToChangeOptions extends ScrollToAnchorOptions {
  /** Move the caret and focus to the changed range start. Default: false. */
  readonly focus?: boolean;
  /** Target alignment. Default: center. centerIfNeeded preserves scroll for an already visible target. */
  readonly block?: 'start' | 'center' | 'centerIfNeeded' | 'nearest';
}

/** External file transport stays in your application. Reload resets selection and undo history. @public */
export interface DocumentRefresh {
  /** Finish pending input and capture bytes with their document revision. Supersedes earlier submissions. */
  capture(): Promise<RefreshSubmission>;
  /** Accept cumulative output. Preserve a clamped scroll position without moving focus. */
  applyUpdate(update: RefreshUpdate): Promise<RefreshResult>;
  /** Cancel pending processing. An accepted result stays loaded. */
  cancel(): void;
  /** End processing when no further output will arrive. */
  finish(submission: RefreshSubmission): void;
  /** Cached state, suitable for framework external-store subscriptions. */
  snapshot(): DocumentRefreshState;
  /** Observe state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Completion notification for every `applyUpdate()` call, including a refused result. */
  onResult(listener: (result: RefreshResult) => void): () => void;
  /** Highlight available changes and return their count, including offscreen locations. Zero means none. Always validates options. */
  highlightChanges(options?: RefreshHighlightOptions): number;
  /** Remove temporary paragraph highlights without changing document content or history. */
  clearHighlights(options?: ClearRefreshHighlightsOptions): void;
  /** Explicit navigation. Does not focus unless requested. Returns false for unavailable locations. */
  navigateToChange(id: string, options?: NavigateToChangeOptions): boolean;
  /** Return a copy for download after recovery fails. */
  recoveryBytes(): ArrayBuffer | null;
  /** Retry recovery only while the failed document session is still active. */
  recover(): Promise<boolean>;
}

/** A capture failure with a stable code. `applyUpdate()` failures use RefreshResult instead. @public */
export class DocumentRefreshError extends Error {
  /** Machine-readable reason. */
  readonly code: RefreshFailureCode;
  constructor(code: RefreshFailureCode, cause?: unknown) {
    super(`Document capture failed: ${code}.`, { cause });
    this.name = 'DocumentRefreshError';
    this.code = code;
  }
}
