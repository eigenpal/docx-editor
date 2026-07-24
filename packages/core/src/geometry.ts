/**
 * `@docx-editor.dev/core/geometry` — the positioned render IR.
 *
 * Core lays the document out and emits an immutable, framework-agnostic
 * positioned render list. A framework adapter paints that list and forwards
 * pointer/scroll events; it never measures, never interprets layout, and never
 * touches an editing engine's internals. Selection and caret geometry are
 * queries on `Editor` (see `core/editor`), not members of this list, because
 * they are derived from the current selection rather than from document
 * content.
 *
 * All boxes are in document content pixels at 96 px/in before zoom, the same
 * coordinate space as `DisplayPage.box`.
 *
 * CONTRACT ONLY. This module is type declarations; it has no runtime.
 */

import type { ViewScope } from './editor';
import type {
  PositionedInteractionMeta,
  SemanticAtomicSpan,
  SemanticTextSpan,
  ShapedCluster,
} from './interaction';
import type { ColorValue, Point, Rect } from './types';

export type * from './types';

/**
 * @deprecated Superseded by {@link SemanticTarget} and {@link SemanticHitTarget}
 * in `core/interaction`. Provisional flat document offsets are not part of the
 * interaction-frame contract.
 */
export interface DocPoint {
  /** Zero-based document offset within the addressed view. */
  readonly docPos: number;
  readonly scope: ViewScope;
}

/**
 * One positioned run of shaped text sharing a single resolved style. The named
 * fields are the common ones; `props` is a deliberately open bag for any
 * additional resolved run properties (highlight, baseline, letter-spacing,
 * caps, effects, direction, …) so the contract can carry more without a
 * breaking change. Adapters read what they understand and ignore the rest.
 */
export interface GlyphRun {
  readonly text: string;
  readonly box: Rect;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly color: ColorValue;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  /** Open extension point for further resolved run properties. */
  readonly props?: Readonly<Record<string, unknown>>;
}

/** A raster or vector image the engine has already resolved to a paintable
 * source. The engine only ever resolves same-origin or embedded parts, so an
 * adapter can paint `url` without an external fetch. */
export interface ImageRef {
  readonly url: string;
  readonly altText?: string;
}

/** One drawn edge of a table border or a page-break cut rule. */
export interface BorderSeg {
  readonly from: Point;
  readonly to: Point;
  readonly widthPx: number;
  readonly color: ColorValue;
  readonly style: 'single' | 'double' | 'dotted' | 'dashed';
}

/**
 * One positioned thing to paint. Content-bearing items carry model-derived
 * {@link SemanticTextSpan} / {@link SemanticAtomicSpan} ranges and shaped
 * cluster maps — not accumulated display offsets. Items that are repainted slices
 * (repeated table headers, merged-cell continuations) set `synthetic: true` so
 * selection mapping can skip them.
 *
 * **This union is intentionally non-exhaustive.** It starts with the common
 * cases; the engine may emit further kinds (shapes, text boxes, watermarks,
 * paragraph/page borders, and so on) and richer `role`s. Adapters MUST paint
 * the kinds they understand and ignore unknown ones — see the `custom` escape
 * hatch — rather than assume this list is closed.
 */
export type DisplayItem =
  | {
      readonly kind: 'text';
      readonly box: Rect;
      readonly runs: readonly GlyphRun[];
      readonly semantic: SemanticTextSpan;
      readonly clusters: readonly ShapedCluster[];
      readonly scope: ViewScope;
      /**
       * @deprecated Compatibility only — derived from {@link semantic}, not from
       * display accumulation. Do not use in new logic.
       */
      readonly docFrom?: number;
      readonly docTo?: number;
      readonly blockId?: number;
      /** A repainted slice (e.g. repeated header); not selectable. */
      readonly synthetic?: boolean;
      readonly interaction?: PositionedInteractionMeta;
    }
  | {
      readonly kind: 'image';
      readonly box: Rect;
      readonly src: ImageRef;
      readonly semantic: SemanticAtomicSpan;
      readonly scope: ViewScope;
      /** @deprecated Compatibility only — do not use in new logic. */
      readonly docFrom?: number;
      readonly docTo?: number;
      /** A repainted slice (e.g. repeated header); not selectable. */
      readonly synthetic?: boolean;
      readonly interaction?: PositionedInteractionMeta;
    }
  | { readonly kind: 'fill'; readonly box: Rect; readonly color: ColorValue; readonly interaction?: PositionedInteractionMeta }
  | {
      readonly kind: 'tableBorder';
      readonly segments: readonly BorderSeg[];
      readonly cut?: 'top' | 'bottom';
    }
  | {
      readonly kind: 'decoration';
      readonly box: Rect;
      /** Open-ended: comment/tracked-change today, more roles later. */
      readonly role: string;
      readonly refId: string;
      /** Free-form detail for the role (revision subtype, author, colour, …). */
      readonly detail?: Readonly<Record<string, unknown>>;
      readonly interaction?: PositionedInteractionMeta;
    }
  /**
   * Escape hatch for anything not yet modelled as a first-class variant. Lets
   * the engine ship new positioned content before the contract names it;
   * adapters that don't recognise `name` skip it.
   */
  | {
      readonly kind: 'custom';
      readonly name: string;
      readonly box: Rect;
      readonly detail?: unknown;
      readonly interaction?: PositionedInteractionMeta;
    };

/** One painted page: its box in content space and the items inside it. */
export interface DisplayPage {
  /** Zero-based page index. */
  readonly index: number;
  readonly box: Rect;
  readonly items: readonly DisplayItem[];
}
