/**
 * `@docx-editor.dev/core/interaction` — PM-free interaction frame contracts.
 *
 * An interaction frame is an immutable, revision-tagged projection of display,
 * page geometry, semantic selection, caret/selection overlays, focus, and
 * composition. Adapters consume one coherent frame (or values tagged with its
 * identity) and never mix display geometry from incompatible revisions.
 *
 * CONTRACT ONLY. This module is type declarations; it has no runtime.
 */

import type { ViewScope } from './editor';
import type { DisplayPage } from './geometry';
import type { Point, Rect } from './types';

/** Opaque identity for one atomic interaction-frame publication. */
export interface InteractionFrameId {
  readonly value: number;
}

/** Revisions and epochs every frame member is tagged against. */
export interface InteractionRevisions {
  /** Canonical store revision when this frame was published. */
  readonly modelRevision: number;
  /** Layout/display revision; stable across selection-only frames. */
  readonly layoutRevision: number;
  /** Resource load epoch (fonts, media, embedded parts). */
  readonly resourceEpoch: number;
  /** Editor configuration epoch (zoom, locale, mode, …). */
  readonly configurationEpoch: number;
}

/** Bidi/grapheme affinity for a text caret or hit target. */
export type InteractionAffinity = 'upstream' | 'downstream';

/** Model-derived text span for a painted display item slice. */
export interface SemanticTextSpan {
  readonly scope: ViewScope;
  readonly identity: SemanticIdentity;
  /** Grapheme indices within the paragraph (half-open). */
  readonly graphemeFrom: number;
  readonly graphemeTo: number;
  /** UTF-16 code unit offsets within the paragraph (half-open). */
  readonly utf16From: number;
  readonly utf16To: number;
}

/** Model-derived atomic span for images and other non-text objects. */
export interface SemanticAtomicSpan {
  readonly scope: ViewScope;
  readonly objectId: string;
}

/**
 * One visual cluster within a text display item mapped to semantic position.
 * Approximate shaping may emit one cluster per grapheme until full bidi/ligature
 * shaping lands in a later milestone.
 */
export interface ShapedCluster {
  readonly clusterIndex: number;
  readonly graphemeFrom: number;
  readonly graphemeTo: number;
  readonly utf16From: number;
  readonly utf16To: number;
  readonly box: Rect;
  readonly logicalOrder: number;
  readonly direction: 'ltr' | 'rtl';
  readonly affinity: InteractionAffinity;
}

/** Explicit caret position emitted from model/layout semantics. */
export interface CaretStop {
  readonly target: SemanticTarget;
  readonly role: InteractionRole;
}

/** Capability-owned hit/whitespace region tied to stable model identity. */
export interface OwnershipRegion {
  readonly scope: ViewScope;
  readonly identity: SemanticIdentity;
  readonly role: InteractionRole;
  readonly kind: 'paragraph' | 'lineWhitespace' | 'trailing' | 'structural';
  /** UTF-16 subrange within the paragraph for whitespace-owned regions (no painted box yet). */
  readonly utf16From?: number;
  readonly utf16To?: number;
  readonly pageIndex?: number;
  readonly box?: Rect;
}

/** One block entry in canonical story order. */
export interface BlockSemanticRecord {
  readonly identity: SemanticIdentity;
  readonly orderIndex: number;
  readonly graphemeCount: number;
  readonly utf16Length: number;
  readonly empty: boolean;
  readonly readOnly: boolean;
}

/** Model-derived semantic ordering for one story/scope. */
export interface StorySemanticIndex {
  readonly storyId: string;
  readonly scope: ViewScope;
  readonly blocks: readonly BlockSemanticRecord[];
}

/**
 * Model-derived semantic position index: canonical block order, caret stops, and
 * ownership regions. Positions never depend on display-item accumulation.
 */
export interface SemanticPositionIndex {
  readonly stories: readonly StorySemanticIndex[];
  readonly caretStops: readonly CaretStop[];
  readonly ownershipRegions: readonly OwnershipRegion[];
}

/** Declared hit ownership and interaction policy for a target. */
export type InteractionRole =
  | 'editableText'
  | 'selectableText'
  | 'atomicObject'
  | 'control'
  | 'annotation'
  | 'background';

/**
 * Model-derived stable identity within a scope. Positions resolve through this
 * index, not accumulated display-item lengths or editing-engine coordinates.
 */
export interface SemanticIdentity {
  readonly storyId: string;
  readonly blockId: string;
}

/** A PM-free semantic caret, range endpoint, or atomic selection target. */
export type SemanticTarget =
  | {
      readonly kind: 'text';
      readonly scope: ViewScope;
      readonly identity: SemanticIdentity;
      readonly graphemeOffset: number;
      readonly affinity: InteractionAffinity;
    }
  | {
      readonly kind: 'atomic';
      readonly scope: ViewScope;
      readonly objectId: string;
    };

/** Result of resolving client coordinates to a semantic interaction target. */
export interface SemanticHitTarget {
  readonly frameId: InteractionFrameId;
  readonly revisions: InteractionRevisions;
  readonly target: SemanticTarget;
  readonly role: InteractionRole;
}

/** Semantic selection expressed with stable targets, not engine positions. */
export interface SemanticSelection {
  readonly frameId: InteractionFrameId;
  readonly scope: ViewScope;
  readonly anchor: SemanticTarget;
  readonly head: SemanticTarget;
}

/** Invertible 2D affine transform in content pixels (no dependency on DOM matrix types). */
export interface AffineTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

/** Explicit host metrics for client/content coordinate mapping (never defaulted in production). */
export interface InteractionHostMetrics {
  /** Client-space origin of the scrollable pages container content box. */
  readonly clientOrigin: Point;
  /** Scroll offsets of the scroll container in CSS pixels. */
  readonly scrollOffset: Point;
  /** Visual zoom applied by the adapter (1 = 100%). */
  readonly zoom: number;
}

/** Positioned interaction metadata carried on display items (adapters paint only). */
export interface PositionedInteractionMeta {
  readonly pageIndex: number;
  readonly zOrder: number;
  readonly clip?: Rect;
  readonly transform?: AffineTransform;
  readonly pointerTransparent?: boolean;
  readonly role?: InteractionRole;
  readonly writingDirection?: 'ltr' | 'rtl';
  readonly writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
}

/** Engine-derived collapsed caret overlay geometry. */
export interface CaretGeometry {
  readonly frameId: InteractionFrameId;
  readonly rect: Rect;
  readonly pageIndex: number;
  readonly writingDirection: 'ltr' | 'rtl';
  readonly writingMode?: PositionedInteractionMeta['writingMode'];
  readonly affinity?: InteractionAffinity;
  readonly clip?: Rect;
  readonly transform?: AffineTransform;
}

/** Engine-derived visible selection overlay geometry. */
export interface SelectionGeometry {
  readonly frameId: InteractionFrameId;
  /** Complete semantic selection retained even when visible rects are viewport-limited. */
  readonly selection: SemanticSelection;
  readonly rects: readonly Rect[];
  readonly pageIndices: readonly number[];
  readonly collapsed: boolean;
}

/** Focus observation projected from the live editing surface. */
export interface FocusObservation {
  readonly scope: ViewScope | null;
  readonly focused: boolean;
}

/** IME/composition observation projected from the live editing surface. */
export interface CompositionObservation {
  readonly active: boolean;
  readonly scope: ViewScope | null;
}

/** Stacked scroll extent from the current interaction frame. */
export interface ScrollGeometry {
  readonly contentHeight: number;
  readonly pageTops: readonly number[];
  /** Vertical gap between stacked pages in stacked content pixels. */
  readonly pageGapPx: number;
}

/** Whether the frame is complete or waiting on derived work. */
export type FrameCompleteness =
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'pending';
      readonly awaiting: 'layout' | 'selection' | 'resources';
      readonly targetModelRevision: number;
    };

/**
 * One immutable interaction frame: every display and geometry member belongs to
 * the same publication identity and revision set.
 */
export interface InteractionFrame {
  readonly id: InteractionFrameId;
  readonly revisions: InteractionRevisions;
  readonly completeness: FrameCompleteness;
  readonly display: readonly DisplayPage[];
  readonly semanticIndex: SemanticPositionIndex;
  readonly pageGeometry: readonly { readonly index: number; readonly box: Rect }[];
  readonly scrollGeometry: ScrollGeometry;
  readonly selection: SemanticSelection | null;
  readonly caret: CaretGeometry | null;
  readonly selectionGeometry: SelectionGeometry | null;
  readonly focus: FocusObservation;
  readonly composition: CompositionObservation;
  readonly currentPage: { readonly viewport: number; readonly caret: number };
}

/** Typed rejection for stale, pending, read-only, invalid, or unsupported interaction. */
export type InteractionOutcomeCode =
  | 'staleFrame'
  | 'pendingLayout'
  | 'pendingSelection'
  | 'readOnly'
  | 'invalidTarget'
  | 'unsupported';

export type InteractionOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly frameId: InteractionFrameId }
  | {
      readonly ok: false;
      readonly code: InteractionOutcomeCode;
      readonly reason: string;
      readonly frameId?: InteractionFrameId;
    };

/** Options for frame-bound pointer resolution. */
export interface HitTestOptions {
  readonly frameId?: InteractionFrameId;
  /** Required for client-coordinate resolution unless {@link EditorHost.getInteractionHostMetrics} is implemented. */
  readonly hostMetrics?: InteractionHostMetrics;
}

/** Options for viewport-limited selection overlay derivation. */
export interface SelectionGeometryOptions {
  readonly visiblePageIndices?: readonly number[];
}

export type { Point };
