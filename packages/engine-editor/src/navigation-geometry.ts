// Private navigation geometry for keyboard navigation (task 5.5).
// Not part of the public core-contract surface — keyed by interaction frame identity.

import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import type {
  InteractionRole,
  SemanticIdentity,
  SemanticTarget,
  PositionedInteractionMeta,
} from '@docx-editor.dev/core-contract/interaction';
import type { Rect } from '@docx-editor.dev/core-contract/types';
import { deepFreezeValue } from './interaction-frame.ts';

/** Layout-published stable identity for one visual line fragment. */
export interface VisualLineIdentity {
  readonly lineId: string;
  readonly fragmentId: string;
  readonly lineIndex: number;
  readonly fragmentIndex: number;
}

/** Per-fragment paint/interaction provenance for clip/transform validation. */
export interface FragmentInteractionMeta {
  readonly pageIndex: number;
  readonly zOrder: number;
  readonly lineId: string;
  readonly fragmentId: string;
  readonly paintSliceAnchor?: number;
  readonly clip?: PositionedInteractionMeta['clip'];
  readonly transform?: PositionedInteractionMeta['transform'];
  readonly writingDirection?: PositionedInteractionMeta['writingDirection'];
  readonly writingMode?: PositionedInteractionMeta['writingMode'];
  readonly role?: PositionedInteractionMeta['role'];
}

/** Caret stop provenance — semantic vs geometry trust (task 5.5). */
export type CaretStopProvenance = 'geometry' | 'semanticWholeGrapheme';

/** One layout-measured caret edge — never interpolated. */
export interface VisualCaretEdge {
  readonly target: Extract<SemanticTarget, { kind: 'text' }>;
  readonly role: InteractionRole;
  readonly pageLocalX: number;
  readonly pageLocalY: number;
  readonly pageLocalHeight: number;
  readonly navigable: boolean;
  readonly provenance: CaretStopProvenance;
  readonly interaction: FragmentInteractionMeta;
}

/** Engine-authoritative visual line catalog entry for navigation. */
export interface VisualLineRecord {
  readonly scope: ViewScope;
  readonly identity: SemanticIdentity;
  readonly pageIndex: number;
  readonly line: VisualLineIdentity;
  readonly lineOrder: number;
  readonly fragmentOrder: number;
  readonly lineBox: Rect;
  readonly interaction: FragmentInteractionMeta;
  readonly edges: readonly VisualCaretEdge[];
}

/** Direction-specific traversable editable block links within one story/scope. */
export interface BlockTraversalLinks {
  readonly previousEditableBlockId: string | null;
  readonly nextEditableBlockId: string | null;
}

/** Navigation-only geometry sidecar for one published interaction frame. */
export interface NavigationGeometry {
  readonly visualLines: readonly VisualLineRecord[];
  readonly traversalByBlockId: Readonly<Record<string, BlockTraversalLinks>>;
  readonly shapingSupported: boolean;
  /** Model-derived whole-grapheme horizontal boundaries per block (private sidecar). */
  readonly semanticHorizontalBoundariesByBlockId: Readonly<Record<string, readonly number[]>>;
  readonly paintFragmentConflicts: readonly string[];
}

export function freezeNavigationGeometry(geometry: NavigationGeometry): NavigationGeometry {
  // Freeze IN PLACE. No clone.
  //
  // This rebuilt the whole graph — a fresh object for every visual line, its identity, its
  // line id, its box, its interaction meta, and then for every caret edge plus that edge's
  // interaction, target and target identity — and froze the copy. On the 24-page styled
  // fixture that is 106,539 edges, so roughly 400,000 allocations per layout, thrown away
  // as soon as the copy was frozen.
  //
  // `buildVisualLines` constructs these objects on this call and nobody else holds a
  // mutable reference to them, so the copy bought nothing. This is the same defect already
  // fixed in `freezeDisplay` and `freezeSemanticIndex`; it was missed here because
  // navigation geometry is frozen inside the bridge rather than at publication, which made
  // publication measure 0 ms for it and hid the cost one stage upstream.
  //
  // Freezing in place also lets a reused chunk short-circuit: `deepFreezeValue` returns
  // immediately on an already-frozen value, so once per-line navigation chunks are reused
  // this walk stops at the first frozen line instead of descending into its edges.
  return deepFreezeValue(geometry);
}

export function emptyNavigationGeometry(): NavigationGeometry {
  return freezeNavigationGeometry({
    visualLines: [],
    traversalByBlockId: {},
    shapingSupported: false,
    semanticHorizontalBoundariesByBlockId: {},
    paintFragmentConflicts: [],
  });
}

export function traversalLinksForBlock(
  geometry: NavigationGeometry | null | undefined,
  blockId: string
): BlockTraversalLinks {
  return (
    geometry?.traversalByBlockId[blockId] ?? {
      previousEditableBlockId: null,
      nextEditableBlockId: null,
    }
  );
}

export function recordFromTraversalMap(
  map: ReadonlyMap<string, BlockTraversalLinks>
): Readonly<Record<string, BlockTraversalLinks>> {
  // Deep, not shallow. A shallow `Object.freeze` makes `deepFreezeValue` bail at its
  // `isFrozen` short-circuit, leaving one mutable `{previousEditableBlockId,
  // nextEditableBlockId}` per block reachable from a published frame — 140 of them on the
  // 24-page fixture, found by review counting unfrozen nodes.
  const record = Object.fromEntries(map);
  for (const value of Object.values(record)) Object.freeze(value);
  return Object.freeze(record);
}
