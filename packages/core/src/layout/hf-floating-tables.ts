// Floating (`w:tblpPr`) tables at the top level of a header or footer story.
//
// Such a table sits at its anchor position, outside the story's text flow: the blocks after
// it start where the table would have started. In a letterhead, a reference table sits at its
// `w:tblpX`/`w:tblpY` page position beside the address block, and the title paragraph after it
// stays at the top of the header.
//
// Only the top-level table floats. A table inside a cell keeps its `w:tblpPr` ignored, as in
// the body (see `readTableStructure`).

import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import type { TableAnchorFrames } from './semantic-table.ts';
import { tableFloatOriginY, type TableVerticalAnchorFrames } from './table-float-position.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';
import { tableFloatOriginX } from './table-origin.ts';

export interface FloatingStoryTable {
  readonly table: OoxmlElement;
  readonly float: TableFloatPosition;
  /** The next block that stays in flow, which a `text` anchor measures from. */
  readonly nextBlockId: string | null;
}

/** The story geometry a floating table resolves its anchors against, in story coordinates. */
export interface FloatingStoryTableFrames {
  readonly contentWidth: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginLeft: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Page y of the story's top edge. */
  readonly storyTop: number;
}

function tableProperties(table: OoxmlElement): OoxmlElement | undefined {
  for (const child of table.children) {
    if (child.kind !== 'textValue' && child.localName === 'tblPr') return child;
  }
  return undefined;
}

/** Split the story's top-level floating tables from the blocks that flow. */
export function splitFloatingStoryTables(blocks: readonly OoxmlElement[]): {
  readonly flowBlocks: readonly OoxmlElement[];
  readonly floating: readonly FloatingStoryTable[];
} {
  const floatOf = (block: OoxmlElement) =>
    block.kind === 'table' ? readTableFloatPosition(tableProperties(block)) : undefined;
  const floating: FloatingStoryTable[] = [];
  const flowBlocks: OoxmlElement[] = [];
  blocks.forEach((block, index) => {
    const float = floatOf(block);
    if (!float) {
      flowBlocks.push(block);
      return;
    }
    const next = blocks.slice(index + 1).find((candidate) => !floatOf(candidate));
    floating.push({ table: block, float, nextBlockId: next?.id ?? null });
  });
  if (floating.length === 0) return { flowBlocks: blocks, floating };
  return { flowBlocks, floating };
}

function fragmentBlockId(fragment: BlockFragmentRecord): string | undefined {
  if (fragment.kind === 'table') return fragment.tableId;
  if (fragment.kind === 'paragraph') return fragment.paragraphId;
  return undefined;
}

/**
 * Place each floating table at its anchor position. `layoutAlone` lays one table out on its
 * own with its container's left edge at `left` and its top at `top`. The first call measures
 * it; the second, with `placed`, places it and may publish the drawings inside it. The fragments are out of flow, so they add nothing to the story's
 * flow height.
 */
export function placeFloatingStoryTables(
  flowFragments: readonly BlockFragmentRecord[],
  flowBottom: number,
  floating: readonly FloatingStoryTable[],
  frames: FloatingStoryTableFrames,
  layoutAlone: (
    table: OoxmlElement,
    left: number,
    top: number,
    placed: boolean
  ) => readonly BlockFragmentRecord[]
): BlockFragmentRecord[] {
  const placed: BlockFragmentRecord[] = [...flowFragments];
  const horizontal: TableAnchorFrames = {
    text: { left: 0, width: frames.contentWidth },
    margin: { left: 0, width: frames.contentWidth },
    page: { left: -frames.marginLeft, width: frames.pageWidth },
  };
  for (const entry of floating) {
    const measured = layoutAlone(entry.table, 0, 0, false).find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    );
    if (!measured) continue;
    const next = flowFragments.find(
      (candidate) => fragmentBlockId(candidate) === entry.nextBlockId
    );
    const textTop = next ? next.box.y : flowBottom;
    const vertical: TableVerticalAnchorFrames = {
      text: { top: textTop, height: Math.max(0, frames.pageHeight - frames.storyTop - textTop) },
      margin: {
        top: frames.marginTop - frames.storyTop,
        height: Math.max(0, frames.pageHeight - frames.marginTop - frames.marginBottom),
      },
      page: { top: -frames.storyTop, height: frames.pageHeight },
    };
    const x = tableFloatOriginX(entry.float, measured.box.width, horizontal);
    const y = tableFloatOriginY(entry.float, measured.box.height, vertical);
    // The alone layout already offset the table by its own indent or alignment.
    for (const fragment of layoutAlone(entry.table, x - measured.box.x, y, true))
      placed.push({ ...fragment, outOfFlow: true } as BlockFragmentRecord);
  }
  return placed;
}
