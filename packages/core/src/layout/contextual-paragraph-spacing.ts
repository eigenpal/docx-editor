import { styleSeparatorMembersOf } from './style-separator-group.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ParagraphSpacing } from './paragraph-style.ts';
import {
  cascadeParagraphFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { hiddenMarkNeighboursOf } from './hidden-paragraph-mark.ts';
import { rowEndMarkStyle } from './row-end-mark-style.ts';
import { tableOpening, type TableEdgeView, type TableOpening } from './table-opening.ts';
import type { CellEdgeNeighbours } from './cell-edge-neighbours.ts';

/** An unnamed paragraph uses the same implicit default style as its unnamed neighbours. */
export function contextualParagraphSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  previous: string | null | undefined,
  next: string | null | undefined
): ParagraphSpacing {
  return enabled
    ? {
        before: previous !== undefined && previous === styleId ? 0 : spacing.before,
        after: next !== undefined && next === styleId ? 0 : spacing.after,
      }
    : spacing;
}

export function neighbourParagraphStyle(
  block: OoxmlElement | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting
): string | null | undefined {
  if (block?.kind !== 'paragraph') return undefined;
  const pPr = block.children.find((node) => node.kind === 'paragraphProperties');
  return styles
    ? cascadeParagraphFormatting(styles, pPr, cellStyle).styleId
    : (propertiesOf(pPr).find((property) => property.localName === 'pStyle')?.attributes?.val ??
        null);
}

/**
 * The style `w:contextualSpacing` (17.3.1.9) compares with across the edge of a table
 * (17.4.37 `w:tbl`) that starts at `opening`. A table edge does not stop the walk through
 * the paragraphs in document order:
 *
 * - a table after the paragraph answers with its first paragraph (`table-opening.ts`);
 * - a table before the paragraph answers with the end mark of its last row
 *   (`row-end-mark-style.ts`), whatever the styles of the cell paragraphs.
 *
 * A table with no row in the view has no edge, and nothing matches.
 */
function tableEdgeStyle(
  opening: TableOpening,
  side: -1 | 1,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  if (opening.rowId === undefined) return undefined;
  return side < 0 ? rowEndMarkStyle(styles) : neighbourParagraphStyle(opening.paragraph, styles);
}

/** The style of `block` as the neighbour on `side` of a paragraph: a paragraph or a table. */
export function neighbourBlockStyle(
  block: OoxmlElement | undefined,
  side: -1 | 1,
  flow: TableEdgeFlow | undefined,
  cellStyle?: TableCellStyleFormatting
): string | null | undefined {
  return block?.kind === 'table'
    ? tableEdgeStyle(tableOpening(block, flow), side, flow?.styleCascade)
    : neighbourParagraphStyle(block, flow?.styleCascade, cellStyle);
}

/** The style table and the revision view of a cell or story flow. */
export interface TableEdgeFlow extends TableEdgeView {
  readonly styleCascade?: StyleCascadeTable;
}

/**
 * `w:contextualSpacing` (17.3.1.9) for a paragraph in cell flow. A side with no paragraph
 * in the cell compares with `edges` from `cell-edge-neighbours.ts`, passed only for a real
 * `w:tc`; with none, nothing matches on that side.
 */
export function cellContextualSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  neighbours: { readonly previous?: OoxmlElement; readonly next?: OoxmlElement } | undefined,
  flow: TableEdgeFlow | undefined,
  cellStyle?: TableCellStyleFormatting,
  edges?: CellEdgeNeighbours
): ParagraphSpacing {
  if (!enabled) return spacing;
  const previous = neighbours?.previous
    ? neighbourBlockStyle(neighbours.previous, -1, flow, cellStyle)
    : edges?.previous?.style;
  const next = neighbours?.next
    ? neighbourBlockStyle(neighbours.next, 1, flow, cellStyle)
    : edges?.next?.style;
  return contextualParagraphSpacing(spacing, true, styleId, previous, next);
}

/** A prepared body block, as far as its neighbours' contextual spacing reads it. */
interface FlowNeighbour {
  readonly kind: string;
  readonly styleId?: string | null;
  readonly contextualSpacing?: boolean;
  readonly paragraph?: OoxmlElement;
  readonly table?: OoxmlElement;
  /** Where a prepared table starts in the view of the flow. */
  readonly opening?: TableOpening;
}

/**
 * The style `w:contextualSpacing` compares against on one side of a body paragraph.
 *
 * A paragraph a hidden mark removed from the flow is still the neighbour on its side; see
 * `hidden-paragraph-mark.ts`. Otherwise the adjacent prepared block answers: a paragraph with
 * its style, a table as {@link tableEdgeStyle} reads its edge, anything else with
 * `undefined`, which never matches.
 */
export function flowNeighbourStyle(
  paragraph: OoxmlElement,
  side: -1 | 1,
  adjacent: FlowNeighbour | undefined,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  const hidden = hiddenMarkNeighboursOf(paragraph);
  const removed = side < 0 ? hidden?.before : hidden?.after;
  if (removed) return neighbourParagraphStyle(removed, styles);
  const members = adjacent?.paragraph ? styleSeparatorMembersOf(adjacent.paragraph) : undefined;
  const member = side < 0 ? members?.at(-1) : members?.[0];
  if (member) return neighbourParagraphStyle(member.paragraph, styles);
  if (adjacent?.kind === 'table') {
    const opening = adjacent.opening ?? (adjacent.table && tableOpening(adjacent.table));
    return opening ? tableEdgeStyle(opening, side, styles) : undefined;
  }
  return adjacent?.kind === 'paragraph' ? adjacent.styleId : undefined;
}

/** {@link flowNeighbourStyle} of the paragraph `prepared[index]`. */
export function flowNeighbourBeside(
  prepared: readonly FlowNeighbour[],
  index: number,
  side: -1 | 1,
  styles: StyleCascadeTable | undefined
): string | null | undefined {
  const paragraph = prepared[index]?.paragraph;
  return paragraph
    ? flowNeighbourStyle(paragraph, side, prepared[index + side], styles)
    : undefined;
}

/**
 * {@link flowNeighbourStyle} as the flow keys read it: `null` never matches, and an
 * unnamed style is `''`, the same encoding as the block's own style.
 */
export function flowNeighbourStyleAt(
  prepared: readonly FlowNeighbour[],
  index: number,
  side: -1 | 1,
  styles: StyleCascadeTable | undefined
): string | null {
  const paragraph = prepared[index]?.paragraph;
  if (!paragraph) return null;
  const style = flowNeighbourStyle(paragraph, side, prepared[index + side], styles);
  return style === undefined ? null : (style ?? '');
}

/**
 * A cell paragraph's neighbours for contextual spacing, with a paragraph a hidden mark
 * removed from the flow standing in on its side.
 */
export function contextualCellNeighbours<
  T extends { readonly previous?: OoxmlElement; readonly next?: OoxmlElement },
>(paragraph: OoxmlElement, neighbours: T | undefined): T | undefined {
  const hidden = hiddenMarkNeighboursOf(paragraph);
  if (!hidden) return neighbours;
  return {
    ...neighbours,
    previous: hidden.before ?? neighbours?.previous,
    next: hidden.after ?? neighbours?.next,
  } as T;
}

/**
 * The `w:contextualSpacing` inputs the flow keys fold, for one section's prepared blocks.
 *
 * A table answers `null` for its own style: it is not a paragraph. As a neighbour, it
 * answers through {@link flowNeighbourStyle}.
 */
export function contextualFlowInputs(
  prepared: readonly FlowNeighbour[],
  styles: StyleCascadeTable | undefined
): {
  readonly contextualSpacingAt: (index: number) => boolean;
  readonly styleIdAt: (index: number) => string | null;
  readonly neighbourStyleAt: (index: number, side: -1 | 1) => string | null;
} {
  const contextual = prepared.map(
    (entry) => entry.kind === 'paragraph' && !!entry.contextualSpacing
  );
  const styleIds = prepared.map((entry) =>
    entry.kind === 'paragraph' ? (entry.styleId ?? '') : null
  );
  return {
    contextualSpacingAt: (index) => contextual[index]!,
    styleIdAt: (index) => styleIds[index] ?? null,
    neighbourStyleAt: (index, side) => flowNeighbourStyleAt(prepared, index, side, styles),
  };
}
