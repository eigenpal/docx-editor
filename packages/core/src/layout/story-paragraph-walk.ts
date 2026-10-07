import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';

const rowParagraphs = new WeakMap<
  OoxmlNode,
  { remaining: number; paragraphs: readonly OoxmlElement[] }
>();

/** Collect story paragraphs, preserving table depth limits across immutable row reuse. */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const visit = (blockList: readonly OoxmlElement[], depth: number): void => {
    for (const block of blockList) {
      if (block.kind === 'paragraph') {
        out.push(block);
        continue;
      }
      if (block.kind !== 'table' || depth >= maxTableDepth) continue;
      for (const row of flattenContentControls(block.children)) {
        if (row.kind !== 'tableRow') continue;
        const remaining = maxTableDepth - depth;
        const cached = rowParagraphs.get(row);
        if (cached?.remaining === remaining) {
          for (const paragraph of cached.paragraphs) out.push(paragraph);
          continue;
        }
        const start = out.length;
        for (const cell of flattenContentControls(row.children)) {
          if (cell.kind !== 'tableCell') continue;
          // Flatten cell SDTs under the shared content-control budget; table nesting still
          // uses `maxTableDepth` for the table walk itself.
          const inner = collectFlowBlocks(cell.children);
          visit(inner, depth + 1);
        }
        if (out.length - start <= 256)
          rowParagraphs.set(row, { remaining, paragraphs: out.slice(start) });
      }
    }
  };
  visit(blocks, 0);
  return out;
}
