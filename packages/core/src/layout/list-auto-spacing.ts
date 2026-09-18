import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphSpacing, type ParagraphSpacing } from './paragraph-style.ts';

type SpacingBlock =
  | {
      readonly kind: 'paragraph';
      readonly props: readonly OoxmlProperty[];
      readonly spacing: ParagraphSpacing;
      readonly contextualSpacing: boolean;
      readonly styleId: string | null;
      readonly listItem?: { readonly numId: string };
    }
  | { readonly kind: 'table' };

/** Word suppresses automatic spacing inside a list, but keeps its outer margins. */
export function resolveListAutoSpacing<T extends SpacingBlock>(
  blocks: readonly T[],
  lineUnitPt = 12
): T[] {
  return blocks.map((block, index) => {
    if (block.kind !== 'paragraph' || (!block.listItem && !block.contextualSpacing)) return block;
    const suppressesAuto = (neighbor: SpacingBlock | undefined): boolean =>
      neighbor?.kind === 'paragraph' &&
      ((block.listItem !== undefined && neighbor.listItem?.numId === block.listItem.numId) ||
        (block.contextualSpacing && neighbor.styleId === block.styleId));
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
      (block.listItem && index === 0) || suppressesAuto(blocks[index - 1])
        ? inner.before
        : outer.before;
    let after = suppressesAuto(blocks[index + 1]) ? inner.after : outer.after;
    if (block.contextualSpacing) {
      const previous = blocks[index - 1];
      const next = blocks[index + 1];
      if (previous?.kind === 'paragraph' && previous.styleId === block.styleId) before = 0;
      if (next?.kind === 'paragraph' && next.styleId === block.styleId) after = 0;
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
