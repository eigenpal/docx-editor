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

/**
 * Browser-backend realization of semantic text geometry in client-space CSS pixels.
 *
 * Semantic selection remains engine-owned. This optional port only reports how
 * the current DOM backend actually rasterized a revision-tagged text position.
 */
export interface RenderedTextGeometryPort {
  caretRect(target: SemanticTarget, frameId: InteractionFrameId): Rect | null;
  selectionRects(range: SemanticSelection, frameId: InteractionFrameId): readonly Rect[];
  targetAtPoint(point: Point, frameId: InteractionFrameId): SemanticTarget | null;
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
  /** Exact non-model shaping producer inputs captured for this layout publication. */
  readonly shapingProvenance?: {
    readonly extensionFingerprint: string;
    readonly shapingHash: string;
    readonly producerVersion: number;
  };
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
  readonly bidiLevel: number;
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
  /** UTF-16 subrange within the paragraph for whitespace-owned regions. */
  readonly utf16From?: number;
  readonly utf16To?: number;
  /**
   * Half-open grapheme range for `lineWhitespace` regions, aligned to paragraph grapheme
   * boundaries. Invariant: when present, `graphemeFrom < graphemeTo` and both lie in
   * `[0, paragraphGraphemeCount]`. Derived from canonical model text, never display items.
   */
  readonly graphemeFrom?: number;
  readonly graphemeTo?: number;
  readonly pageIndex?: number;
  readonly box?: Rect;
}

/** Model-derived Unicode word segment within one paragraph (half-open grapheme range). */
export interface WordSegmentRecord {
  /** Grapheme index where this segment starts (inclusive). */
  readonly graphemeFrom: number;
  /** Grapheme index where this segment ends (exclusive); always a paragraph grapheme boundary. */
  readonly graphemeTo: number;
  /** Whether Intl (or the bounded fallback) classified the segment as word-like. */
  readonly wordLike: boolean;
}

/** One block entry in canonical story order. */
export interface BlockSemanticRecord {
  readonly identity: SemanticIdentity;
  readonly orderIndex: number;
  readonly graphemeCount: number;
  readonly utf16Length: number;
  readonly empty: boolean;
  readonly readOnly: boolean;
  /**
   * Canonical model-derived word segments for double-click selection on this paragraph.
   * Built from run-joined paragraph text via {@link WordSegmentRecord} grapheme ranges;
   * never from display items, DOM, or ProseMirror positions. Endpoints always align with
   * grapheme cluster boundaries (combining marks, surrogate pairs, ZWJ, variation selectors).
   * When {@link Intl.Segmenter} is unavailable, segments use a bounded deterministic fallback
   * that is grapheme-safe but not full UAX #29 word-boundary conformance.
   */
  readonly wordSegments: readonly WordSegmentRecord[];
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

/** Typed composition cancel outcome surfaced after a safe abort. */
export interface CompositionCancelObservation {
  readonly code: 'remoteInvalidation' | 'capabilityBoundary' | 'cancelled';
  readonly reason: string;
}

/** IME/composition observation projected from the live editing surface. */
export interface CompositionObservation {
  readonly active: boolean;
  readonly scope: ViewScope | null;
  /** Last safe cancel outcome; null when idle or after a successful commit/new composition. */
  readonly lastCancel?: CompositionCancelObservation | null;
}

/** Typed rejection for bounded clipboard/drop/beforeinput handling at the trust boundary. */
export interface InputRejectionObservation {
  readonly code:
    | 'oversizedPayload'
    | 'unsupportedStructure'
    | 'unsafeResource'
    | 'filePayload'
    | 'capabilityBoundary'
    | 'unsupportedInputType'
    | 'inputNotAuthorized';
  readonly reason: string;
}

/** Native input observation projected from the live editing surface. */
export interface InputObservation {
  readonly lastRejection: InputRejectionObservation | null;
}

/** Who owns the accessible semantic projection for the body-paragraph gate. */
export type AccessibilityProjectionOwner = 'proseMirrorInputHost' | 'none';

/**
 * Adapter-provided accessible name policy. When absent, callers MUST NOT invent an
 * untranslated fallback label in the accessibility tree.
 */
export type AccessibilityNamePolicy =
  | { readonly kind: 'provided'; readonly value: string }
  | { readonly kind: 'absent' };

/** Canonical accessibility role for one block entry in reading order. */
export type AccessibilityEntryRole = 'editableParagraph' | 'readOnlyAtom' | 'unsupportedStructure';

/** One canonical block entry projected for accessibility conformance. */
export interface AccessibilityEntry {
  readonly orderIndex: number;
  readonly identity: SemanticIdentity;
  readonly role: AccessibilityEntryRole;
  readonly readOnly: boolean;
  /** UTF-16 text for editable paragraphs; empty for empty paragraphs and atoms. */
  readonly text: string;
  /** Declared block kind for read-only atoms (for example `table`). */
  readonly atomKind?: string;
}

/** Semantic selection mapped to canonical targets (never PM positions). */
export interface AccessibilitySelectionObservation {
  readonly collapsed: boolean;
  readonly anchor: SemanticTarget;
  readonly head: SemanticTarget;
}

/**
 * PM-free immutable accessibility observation for conformance. Projects store/PM
 * state without exposing ProseMirror types, DOM ranges, or adapter framework types.
 */
export interface AccessibilityObservation {
  readonly owner: AccessibilityProjectionOwner;
  readonly scope: ViewScope;
  readonly frameId: InteractionFrameId;
  readonly modelRevision: number;
  readonly editable: boolean;
  readonly name: AccessibilityNamePolicy;
  readonly entries: readonly AccessibilityEntry[];
  readonly focus: FocusObservation;
  readonly selection: AccessibilitySelectionObservation | null;
  /** Set only while an attached PM semantic projection owns assistive access. */
  readonly paintedPagesAssistiveRole: 'presentation' | null;
}

/** Why the hidden input-host clip shell is at its current client rectangle. */
export type InputHostPlacementReason =
  | 'applied'
  | 'staleFrame'
  | 'pendingLayout'
  | 'noCaret'
  | 'readOnly'
  | 'fallback';

/** PM-free observation of the attached hidden input-host clip shell. */
export interface InputHostObservation {
  readonly attached: boolean;
  readonly placementReason: InputHostPlacementReason;
  readonly clientRect: Rect;
  readonly paintedPagesAssistiveRole: 'presentation' | null;
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
  readonly pageGeometry: readonly {
    readonly index: number;
    readonly box: Rect;
    /** The page's text area in the same coordinate space as `box` — the page inset by the
     *  section margin. Rulers draw their margin zones from this rather than assuming a
     *  default; the engine's margin is uniform on all four sides today. */
    readonly contentBox: Rect;
  }[];
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

// ─── Interaction controller (task 5.1) ───────────────────────────────────────
// PM-free native intents and planned effects. Intents carry normalized serializable
// data only; effects route through EditorBinding, EditSurface, or host passthrough.

/** Serializable pointer intent (no DOM Event or framework types). */
export interface PointerInteractionIntent {
  readonly kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'click';
  readonly frameId: InteractionFrameId;
  readonly clientPoint: Point;
  readonly pointerId?: number;
  /** Bitmask of pressed buttons during the gesture; omitted when unknown. */
  readonly buttons?: number;
  /** Normalized primary button (0). Omitted defaults to primary. */
  readonly button?: number;
  /** Normalized click count: exactly 1 when present; omitted defaults to single click. */
  readonly clickCount?: number;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/** Serializable keyboard intent that requires engine geometry (task 5.5+). */
export interface GeometryKeyboardInteractionIntent {
  readonly kind: 'geometryKeyboard';
  readonly frameId: InteractionFrameId;
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/** Native interaction intent accepted by the shared controller planner. */
export type InteractionIntent =
  | {
      readonly kind: 'semanticSelection';
      readonly frameId: InteractionFrameId;
      readonly selection: SemanticSelection;
    }
  | { readonly kind: 'focus'; readonly frameId: InteractionFrameId }
  | { readonly kind: 'blur'; readonly frameId: InteractionFrameId }
  | {
      readonly kind: 'command';
      readonly frameId: InteractionFrameId;
      readonly command: import('./editor').EditorCommand;
    }
  | { readonly kind: 'delegateNativeInput'; readonly frameId: InteractionFrameId }
  | PointerInteractionIntent
  | GeometryKeyboardInteractionIntent
  | {
      readonly kind: 'capturePointer';
      readonly frameId: InteractionFrameId;
      readonly pointerId: number;
    }
  | {
      readonly kind: 'releasePointer';
      readonly frameId: InteractionFrameId;
      readonly pointerId: number;
    }
  | { readonly kind: 'scroll'; readonly frameId: InteractionFrameId; readonly delta: Point };

/** Engine effect: synchronize semantic selection through EditorBinding. */
export interface SyncSelectionInteractionEffect {
  readonly kind: 'syncSelection';
  readonly frameId: InteractionFrameId;
  readonly selection: SemanticSelection;
}

/** Engine effect: focus the edit surface at the current frame. */
export interface FocusInteractionEffect {
  readonly kind: 'focus';
  readonly frameId: InteractionFrameId;
}

/** Engine effect: blur the edit surface. */
export interface BlurInteractionEffect {
  readonly kind: 'blur';
}

/** Engine effect: execute a public editor command. */
export interface ExecCommandInteractionEffect {
  readonly kind: 'execCommand';
  readonly frameId: InteractionFrameId;
  readonly command: import('./editor').EditorCommand;
}

/** Engine effect: authorize native input delegation at the current frame. */
export interface DelegateNativeInputInteractionEffect {
  readonly kind: 'delegateNativeInput';
  readonly frameId: InteractionFrameId;
}

/** Engine effect: publish selection/caret overlay from binding-backed selection without refocusing. */
export interface PublishSelectionOverlayInteractionEffect {
  readonly kind: 'publishSelectionOverlay';
  readonly frameId: InteractionFrameId;
  readonly selection: SemanticSelection;
}

/** Host effect: request pointer capture (adapter applies). */
export interface CapturePointerInteractionEffect {
  readonly kind: 'capturePointer';
  readonly pointerId: number;
}

/** Host effect: release pointer capture (adapter applies). */
export interface ReleasePointerInteractionEffect {
  readonly kind: 'releasePointer';
  readonly pointerId: number;
}

/** Host effect: scroll the pages container (adapter applies). */
export interface ScrollInteractionEffect {
  readonly kind: 'scroll';
  readonly delta: Point;
}

/** Typed rejection that short-circuits all later planned effects. */
export interface RejectInteractionEffect {
  readonly kind: 'reject';
  readonly code: InteractionOutcomeCode;
  readonly reason: string;
  readonly frameId?: InteractionFrameId;
}

export type InteractionEngineEffect =
  | SyncSelectionInteractionEffect
  | FocusInteractionEffect
  | BlurInteractionEffect
  | ExecCommandInteractionEffect
  | DelegateNativeInputInteractionEffect
  | PublishSelectionOverlayInteractionEffect
  | RejectInteractionEffect;

export type InteractionHostEffect =
  | CapturePointerInteractionEffect
  | ReleasePointerInteractionEffect
  | ScrollInteractionEffect;

/** One ordered controller plan bound to a single interaction frame. */
export type InteractionEffect = InteractionEngineEffect | InteractionHostEffect;

export interface InteractionPlan {
  readonly frameId: InteractionFrameId;
  readonly effects: readonly InteractionEffect[];
}

/** Result of dispatching one interaction intent through the public editor surface. */
export interface InteractionDispatchResult {
  readonly outcome: InteractionOutcome<void>;
  readonly hostEffects: readonly InteractionHostEffect[];
}

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
