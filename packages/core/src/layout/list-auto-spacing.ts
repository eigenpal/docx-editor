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
export function resolveListAutoSpacing<T extends SpacingBlock>(blocks: readonly T[]): T[] {
  return blocks.map((block, index) => {
    if (block.kind !== 'paragraph' || !block.listItem) return block;
    const suppressesAuto = (neighbor: SpacingBlock | undefined): boolean =>
      neighbor?.kind === 'paragraph' &&
      (neighbor.listItem?.numId === block.listItem!.numId ||
        (block.contextualSpacing && block.styleId !== null && neighbor.styleId === block.styleId));
    // Recompute both answers from properties: a reused prepass entry may have been the
    // last item before Enter, or an interior item before the next paragraph was deleted.
    // Include contextual suppression here so keep-with-next prices the same automatic
    // margins as placement. Explicit contextual spacing is still handled by placement.
    const outer = paragraphSpacing(block.props);
    const inner = paragraphSpacing(block.props, { inList: true });
    // Word also suppresses automatic before-spacing at the start of a story/section.
    const before = index === 0 || suppressesAuto(blocks[index - 1]) ? inner.before : outer.before;
    const after = suppressesAuto(blocks[index + 1]) ? inner.after : outer.after;
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
