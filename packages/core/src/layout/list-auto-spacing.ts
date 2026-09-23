import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { flowNeighbourStyle } from './contextual-paragraph-spacing.ts';
import { paragraphSpacing, type ParagraphSpacing } from './paragraph-style.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

type SpacingBlock =
  | {
      readonly kind: 'paragraph';
      readonly props: readonly OoxmlProperty[];
      readonly spacing: ParagraphSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly listItem?: { readonly numId: string };
      readonly paragraph?: OoxmlElement;
    }
  | { readonly kind: 'table' };

/**
 * Automatic spacing is suppressed inside a list, but its outer margins remain.
 *
 * Contextual spacing compares against the neighbour `flowNeighbourStyle` names, so a
 * paragraph a hidden mark removed from the flow still counts; `styles` resolves its style.
 */
export function resolveListAutoSpacing<T extends SpacingBlock>(
  blocks: readonly T[],
  lineUnitPt = 12,
  styles?: StyleCascadeTable
): T[] {
  return blocks.map((block, index) => {
    if (block.kind !== 'paragraph' || (!block.listItem && !block.contextualSpacing)) return block;
    const sameStyle = (side: -1 | 1): boolean => {
      const adjacent = blocks[index + side];
      const style = block.paragraph
        ? flowNeighbourStyle(block.paragraph, side, adjacent, styles)
        : adjacent?.kind === 'paragraph'
          ? adjacent.styleId
          : undefined;
      return style !== undefined && style === block.styleId;
    };
    const suppressesAuto = (side: -1 | 1): boolean => {
      const neighbor = blocks[index + side];
      const sameList =
        neighbor?.kind === 'paragraph' &&
        block.listItem !== undefined &&
        neighbor.listItem?.numId === block.listItem.numId;
      return sameList || (block.contextualSpacing && sameStyle(side));
    };
    // Recompute both answers from properties: a reused prepass entry may have been the
    // last item before Enter, or an interior item before the next paragraph was deleted.
    // Include contextual suppression here so keep-with-next prices the same margins
    // as placement, including explicit spacing on unnamed paragraphs.
    const outer = paragraphSpacing(block.props, { lineUnitPt });
    const inner = paragraphSpacing(block.props, {
      inList: block.listItem !== undefined,
      lineUnitPt,
    });
    // Word also suppresses automatic before-spacing at the start of a story/section.
    let before =
      (block.listItem && index === 0) || suppressesAuto(-1) ? inner.before : outer.before;
    let after = suppressesAuto(1) ? inner.after : outer.after;
    if (block.contextualSpacing) {
      if (sameStyle(-1)) before = 0;
      if (sameStyle(1)) after = 0;
    }
    if (before === block.spacing.before && after === block.spacing.after) return block;
    return { ...block, spacing: { before, after } };
  });
}

/** Neighbor changes must invalidate placement before keep-next folds consume the keys. */
export function listAutoSpacingFlowKeys(keys: string[], blocks: readonly SpacingBlock[]): string[] {
  let flow = keys;
  blocks.forEach((block, index) => {
    if (block.kind !== 'paragraph' || block.listItem === undefined) return;
    if (flow === keys) flow = [...keys];
    flow[index] = `${flow[index]}~ls~${block.spacing.before},${block.spacing.after}`;
  });
  return flow;
}
