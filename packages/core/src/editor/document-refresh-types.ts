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
export interface RefreshHighlightAnimation {
  /** Fade duration in milliseconds. Default: 180. Must be finite and between 0 and 10000. */
  readonly durationMs?: number;
  /** Automatic and explicit exit fade duration. Defaults to durationMs. Range: 0 through 10000. */
  readonly exitDurationMs?: number;
  /** CSS timing function for both fades. Defaults to --doc-motion-ease-out. CSS variables are not accepted here. */
  readonly easing?: string;
}

/** Presentation for temporary paragraph highlights. Each call starts from these defaults. @public */
export interface RefreshHighlightOptions {
  /** Include earlier changes from the latest cumulative result. Default: false. */
  readonly includePrevious?: boolean;
  /** Select these change IDs instead of the recent/all filter. Unknown or unavailable IDs are skipped. Empty means none. */
  readonly changeIds?: readonly string[];
  /** CSS color, including var(). Default: var(--doc-refresh-highlight-color), a light blue. */
  readonly color?: string;
  /** Fill opacity, from 0 to 1. Default: 0.14. Does not change document text opacity. */
  readonly opacity?: number;
  /** Extra space on each edge, in CSS pixels at 100% zoom. Default: 4. Must be finite and nonnegative. */
  readonly padding?: number;
  /** Corner radius in CSS pixels at 100% zoom. Default: 6. Must be finite and nonnegative. */
  readonly borderRadius?: number;
  /** Border width in CSS pixels at 100% zoom. Default: 0. Finite and nonnegative. */
  readonly borderWidth?: number;
  /** CSS border color. Defaults to color. Use an alpha color for a translucent border; opacity controls only the fill. */
  readonly borderColor?: string;
  /** Border pattern. Default: solid. */
  readonly borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** Optional CSS classes for extra decoration, such as shadows or patterns. Geometry remains engine-owned. */
  readonly className?: string;
  /** Milliseconds before dismissal starts. Default: 3000. Null keeps highlights until cleared. Maximum: 2147483647. */
  readonly timeoutMs?: number | null;
  /** Default: true, a 180ms fade. False disables motion. Repeated calls do not replay the entrance. */
  readonly animation?: boolean | RefreshHighlightAnimation;
}

/** Explicit highlight dismissal. Document edits always remove stale highlights immediately. @public */
export interface ClearRefreshHighlightsOptions {
  /** Defaults to the last highlightChanges() animation. False removes highlights immediately. */
  readonly animation?: boolean | RefreshHighlightAnimation;
}

/** Explicit change navigation. Does not change the default scroll preservation during refresh. @public */
export interface NavigateToChangeOptions {
  /** Move the caret and focus to the changed range start. Default: false. */
  readonly focus?: boolean;
  /** Target alignment. Default: center. centerIfNeeded preserves scroll for an already visible target. */
  readonly block?: 'start' | 'center' | 'centerIfNeeded' | 'nearest';
  /** Default: instant. Reduced motion uses instant even when smooth is requested. */
  readonly behavior?: 'instant' | 'smooth';
  /** Edge padding for start/nearest placement, in CSS pixels. Default: 24. Finite and nonnegative. */
  readonly offsetPx?: number;
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
