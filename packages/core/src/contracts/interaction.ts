/**
 * `@docx-editor.dev/core/interaction` — how the engine ADDRESSES content.
 *
 * Semantic identities, targets and selections: the vocabulary a caller uses to say WHICH
 * text it means, independent of layout, DOM or any editing engine's positions.
 *
 * It used to be much larger. An "interaction frame" lived here — a revision-tagged
 * projection of display, page geometry, caret and selection overlays, focus, composition
 * and accessibility, together with a typed pointer-intent dispatch protocol — and every one
 * of those declarations was consumed by exactly nothing. They described an architecture the
 * engine does not use: the paginated surface owns pointer interaction internally and paints
 * through `Editor.attach`, so no frame was ever published and no intent ever dispatched.
 * Two of them (`CaretGeometry`, `HitTestOptions`) also collided by name with the REAL,
 * differently-shaped types in `layout/`, so the published contract carried a second
 * definition of a live concept. Removed with the facade members that named them.
 *
 * CONTRACT ONLY. This module is type declarations; it has no runtime.
 */

import type { ViewScope } from './editor';
import type { Rect } from './types';

/** Opaque identity for one atomic interaction-frame publication. */
export interface InteractionFrameId {
  readonly value: number;
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
