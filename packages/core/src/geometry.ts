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

import type { EditorScope } from './editor';
import type { ColorValue, Point, Rect } from './types';

export type * from './types';

/**
 * A resolved document position inside one view. Distinct from `DocAnchor`
 * (`{ paraId, search }`) on purpose: a hit test resolves to a concrete document
 * offset in a specific body or header/footer view, not to a searchable anchor.
 */
export interface DocPoint {
  /** Zero-based document offset within the addressed view. */
  readonly docPos: number;
  readonly scope: EditorScope;
}

/** One positioned run of shaped text sharing a single resolved style. */
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
 * One positioned thing to paint. Every content-bearing item carries
 * `docFrom`/`docTo`/`scope`, which is what lets selection map to geometry
 * without the adapter ever holding a document position of its own.
 *
 * The variant set is the paint projection of the pagination content model; new
 * content kinds add a variant here and are surfaced by the `rendering-engine`
 * spec.
 */
export type DisplayItem =
  | {
      readonly kind: 'text';
      readonly box: Rect;
      readonly runs: readonly GlyphRun[];
      readonly docFrom: number;
      readonly docTo: number;
      readonly blockId: number;
      readonly scope: EditorScope;
    }
  | {
      readonly kind: 'image';
      readonly box: Rect;
      readonly src: ImageRef;
      readonly docFrom: number;
      readonly docTo: number;
      readonly scope: EditorScope;
    }
  | { readonly kind: 'fill'; readonly box: Rect; readonly color: ColorValue }
  | {
      readonly kind: 'tableBorder';
      readonly segments: readonly BorderSeg[];
      readonly cut?: 'top' | 'bottom';
    }
  | {
      readonly kind: 'decoration';
      readonly box: Rect;
      readonly role: 'comment' | 'trackedChange';
      readonly refId: string;
    };

/** One painted page: its box in content space and the items inside it. */
export interface DisplayPage {
  /** Zero-based page index. */
  readonly index: number;
  readonly box: Rect;
  readonly items: readonly DisplayItem[];
}
