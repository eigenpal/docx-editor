import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ParagraphSpacing } from './paragraph-style.ts';
import {
  cascadeParagraphFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { hiddenMarkNeighboursOf } from './hidden-paragraph-mark.ts';

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

export function cellContextualSpacing(
  spacing: ParagraphSpacing,
  enabled: boolean,
  styleId: string | null,
  neighbours: { readonly previous?: OoxmlElement; readonly next?: OoxmlElement } | undefined,
  styles: StyleCascadeTable | undefined,
  cellStyle?: TableCellStyleFormatting
): ParagraphSpacing {
  if (!enabled) return spacing;
  return contextualParagraphSpacing(
    spacing,
    true,
    styleId,
    neighbourParagraphStyle(neighbours?.previous, styles, cellStyle),
    neighbourParagraphStyle(neighbours?.next, styles, cellStyle)
  );
}

/** A prepared body block, as far as its neighbours' contextual spacing reads it. */
interface FlowNeighbour {
  readonly kind: string;
  readonly styleId?: string | null;
  readonly contextualSpacing?: boolean;
  readonly paragraph?: OoxmlElement;
}

/**
 * The style `w:contextualSpacing` compares against on one side of a body paragraph.
 *
 * A paragraph a hidden mark removed from the flow is still the neighbour on its side; see
 * `hidden-paragraph-mark.ts`. Otherwise the adjacent prepared block answers: a paragraph with
 * its style, anything else with `undefined`, which never matches.
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
  return adjacent?.kind === 'paragraph' ? adjacent.styleId : undefined;
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
 * A table answers `null` for its style, which is what the fold means by "not a paragraph of
 * this style".
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
