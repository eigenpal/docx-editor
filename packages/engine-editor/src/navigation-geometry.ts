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
  return deepFreezeValue({
    visualLines: deepFreezeValue(
      geometry.visualLines.map((line) =>
        deepFreezeValue({
          ...line,
          identity: deepFreezeValue({ ...line.identity }),
          line: deepFreezeValue({ ...line.line }),
          lineBox: deepFreezeValue({ ...line.lineBox }),
          interaction: deepFreezeValue({ ...line.interaction }),
          edges: deepFreezeValue(
            line.edges.map((edge) =>
              deepFreezeValue({
                ...edge,
                interaction: deepFreezeValue({ ...edge.interaction }),
                target: deepFreezeValue({
                  ...edge.target,
                  identity: deepFreezeValue({ ...edge.target.identity }),
                }),
              })
            )
          ),
        })
      )
    ),
    traversalByBlockId: deepFreezeValue({ ...geometry.traversalByBlockId }),
    shapingSupported: geometry.shapingSupported,
    semanticHorizontalBoundariesByBlockId: deepFreezeValue({
      ...geometry.semanticHorizontalBoundariesByBlockId,
    }),
    paintFragmentConflicts: deepFreezeValue([...geometry.paintFragmentConflicts]),
  });
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
  return Object.freeze(Object.fromEntries(map));
}
