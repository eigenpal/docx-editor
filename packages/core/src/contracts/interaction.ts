/**
 * `@docx-editor.dev/core/contracts/interaction` — pointer and keyboard intents, DOM-free.
 *
 * Intents carry normalized serializable coordinates and resolve against a laid-out FRAME, so an
 * intent arriving after that frame was superseded is refused rather than applied to coordinates
 * that have stopped describing the document.
 *
 * Semantic identities, targets and selections: the vocabulary a caller uses to say WHICH
 * text it means, independent of layout, DOM or any editing engine's positions. That is the
 * whole module now.
 * It used to be 599 lines. An "interaction frame" lived here — a revision-tagged projection
 * of display, page geometry, caret and selection overlays, focus, composition and
 * accessibility, plus a typed pointer-intent dispatch protocol and a render IR of glyph
 * runs — and every one of those declarations was consumed by exactly nothing. They
 * described an architecture the engine does not use: the paginated surface owns pointer
 * interaction internally and paints through `Editor.attach`, so no frame was ever published
 * and no intent ever dispatched.
 * THREE of them (`CaretGeometry`, `HitTestOptions`, `ShapedCluster`) also collided by name
 * with the REAL, differently-shaped types in `layout/`, so the published contract carried a
 * second definition of a live concept and `import { ShapedCluster }` meant different things
 * depending on which module you reached for.
 *
 * CONTRACT ONLY — declarations, not an implementation.
 *
 * @packageDocumentation
 * @public
 */

import type { ViewScope } from './editor';

/** Opaque identity for one atomic interaction-frame publication. */
export interface InteractionFrameId {
  readonly value: number;
}

/** Bidi/grapheme affinity for a text caret or hit target. */
export type InteractionAffinity = 'upstream' | 'downstream';

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

/** Typed rejection for stale, pending, read-only, invalid, or unsupported interaction. */
export type InteractionOutcomeCode =
  | 'staleFrame'
  | 'pendingLayout'
  | 'pendingSelection'
  | 'readOnly'
  | 'invalidTarget'
  | 'unsupported';

/**
 * The result of one interaction attempt, carrying the frame it was resolved against.
 *
 * The `frameId` is the point: pointer work is planned against a laid-out frame, and an intent
 * arriving after that frame has been superseded is refused with `staleFrame` rather than applied
 * to coordinates that have stopped describing the document.
 */
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
