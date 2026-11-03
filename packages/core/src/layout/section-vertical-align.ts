// Section vertical alignment (`w:sectPr/w:vAlign`, §17.6.23).
//
// A page whose body belongs to one centered or bottom-aligned section moves that body down
// inside the text area. A justified (`both`) page spreads the free height evenly between its
// paragraphs; the lines of one paragraph stay together. The empty paragraph that carries the
// section break takes no room. A page that holds more than one section stays top-aligned.
//
// Applied to a COMPLETE pass, page by page, after pagination and notes. Pagination keeps
// flowing against top-aligned geometry, so an incremental pass never reads moved records:
// the layout session keeps the top-aligned pages, and each published page is memoized on the
// page it moves, so an unchanged page keeps its identity across passes.
//
// Not applied: multi-column sections, pages with notes, text frames, floating tables, or
// drawings that wrap text, and justified pages that hold a table. Those pages stay
// top-aligned.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import {
  paragraphSectionNode,
  type DocumentSection,
  type SectionVerticalAlign,
} from './section-properties.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from './semantic-records.ts';

const TEXT_WRAPPING = new Set([
  'square',
  'squareLeft',
  'squareRight',
  'tight',
  'through',
  'topAndBottom',
]);

interface AlignedPage {
  readonly alignment: SectionVerticalAlign;
  readonly carrier: boolean;
  readonly page: PageRecord;
}
const alignedPages = new WeakMap<PageRecord, AlignedPage>();
const publishedPages = new WeakSet<PageRecord>();

/** Whether any section aligns its pages other than at the top. */
export function sectionsAlignVertically(sections: readonly DocumentSection[]): boolean {
  return sections.some((section) => section.properties.verticalAlign !== undefined);
}

/**
 * The published layout with each eligible page's body moved by its section's `w:vAlign`.
 * Returns `layout` itself when no page moves.
 */
export function alignSectionPagesVertically(
  layout: SemanticLayout,
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[]
): SemanticLayout {
  if (!sectionsAlignVertically(sections)) return layout;
  const sectionOfBlock = new Map<string, number>();
  const carriers = new Set<string>();
  for (const section of sections) {
    const end = Math.min(section.blockEndExclusive, blocks.length);
    for (let index = section.blockStart; index < end; index += 1)
      sectionOfBlock.set(blocks[index]!.id, section.index);
    const last = blocks[end - 1];
    if (last && end > section.blockStart && paragraphSectionNode(last)) carriers.add(last.id);
  }
  let changed = false;
  const pages = layout.pages.map((page) => {
    const next = alignPage(page, sections, sectionOfBlock, carriers);
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...layout, pages } : layout;
}

function alignPage(
  page: PageRecord,
  sections: readonly DocumentSection[],
  sectionOfBlock: ReadonlyMap<string, number>,
  carriers: ReadonlySet<string>
): PageRecord {
  if (publishedPages.has(page)) return page;
  if (page.parityBlank || page.noteStream || page.footnotes || page.endnotes) return page;
  if (page.fragments.length === 0) return page;
  let sectionIndex: number | undefined;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph' ? fragment.outOfFlow : fragment.floatingWrap) return page;
    const index = sectionOfBlock.get(
      fragment.kind === 'paragraph' ? fragment.paragraphId : fragment.tableId
    );
    if (index === undefined || (sectionIndex !== undefined && index !== sectionIndex)) return page;
    sectionIndex = index;
  }
  const properties = sections.find((section) => section.index === sectionIndex)?.properties;
  const alignment = properties?.verticalAlign;
  if (alignment === undefined || properties!.columns.count > 1) return page;
  if (page.anchoredDrawings?.some((drawing) => TEXT_WRAPPING.has(drawing.wrap))) return page;

  const final = page.fragments.at(-1)!;
  const carrier =
    final.kind === 'paragraph' && carriers.has(final.paragraphId) && isEmptyParagraph(final);
  const memo = alignedPages.get(page);
  if (memo && memo.alignment === alignment && memo.carrier === carrier) return memo.page;

  const measured = carrier ? page.fragments.slice(0, -1) : page.fragments;
  const offsets = bodyOffsets(measured, page.contentBox.height, alignment);
  const aligned = offsets ? shiftPageBody(page, offsets) : page;
  alignedPages.set(page, { alignment, carrier, page: aligned });
  if (aligned !== page) publishedPages.add(aligned);
  return aligned;
}

/**
 * How far each measured fragment moves; the carrier after them moves with the last one.
 * `null` when nothing moves.
 */
function bodyOffsets(
  measured: readonly BlockFragmentRecord[],
  height: number,
  alignment: SectionVerticalAlign
): readonly number[] | null {
  let bottom = 0;
  for (const fragment of measured) bottom = Math.max(bottom, fragment.box.y + fragment.box.height);
  const slack = height - bottom;
  if (measured.length === 0 || slack <= 0.01) return null;
  if (alignment !== 'both') {
    const dy = alignment === 'center' ? slack / 2 : slack;
    return measured.map(() => dy);
  }
  // Rows of a justified table spread apart as well; that stays unsupported.
  if (measured.length < 2 || measured.some((fragment) => fragment.kind === 'table')) return null;
  const gap = slack / (measured.length - 1);
  return measured.map((_, index) => index * gap);
}

function isEmptyParagraph(fragment: ParagraphFragmentRecord): boolean {
  return (
    !fragment.marker &&
    fragment.lines.every(
      (line) => !line.drawings?.length && line.spans.every((span) => span.text.length === 0)
    )
  );
}

function shiftPageBody(page: PageRecord, offsets: readonly number[]): PageRecord {
  const paragraphs = new Map<string, number>();
  const cellParagraphs = new Map<string, number>();
  const fragments = page.fragments.map((fragment, index) =>
    shiftBlock(
      fragment,
      offsets[Math.min(index, offsets.length - 1)]!,
      paragraphs,
      cellParagraphs,
      false
    )
  );
  const anchoredDrawings = page.anchoredDrawings?.map((drawing) => {
    const dy = textOffset(drawing, paragraphs, cellParagraphs);
    return dy === undefined ? drawing : shiftAnchoredDrawing(drawing, 0, dy);
  });
  return {
    ...page,
    fragments,
    ...(anchoredDrawings ? { anchoredDrawings: Object.freeze(anchoredDrawings) } : {}),
  };
}

/**
 * How far a drawing positioned from its paragraph or line moves: as far as that paragraph.
 * Page and margin frames stay, except for a drawing laid out in its table cell.
 */
function textOffset(
  drawing: AnchoredDrawingRecord,
  paragraphs: ReadonlyMap<string, number>,
  cellParagraphs: ReadonlyMap<string, number>
): number | undefined {
  const relative = drawing.verticalFrame === 'paragraph' || drawing.verticalFrame === 'line';
  const body = paragraphs.get(drawing.anchorParagraphId);
  if (body !== undefined) return relative ? body : undefined;
  const cell = cellParagraphs.get(drawing.anchorParagraphId);
  return cell !== undefined && (relative || drawing.layoutInCell) ? cell : undefined;
}

const moveBox = (box: LayoutBox, dy: number): LayoutBox => ({ ...box, y: box.y + dy });

function shiftBlock(
  block: BlockFragmentRecord,
  dy: number,
  paragraphs: Map<string, number>,
  cellParagraphs: Map<string, number>,
  inCell: boolean
): BlockFragmentRecord {
  if (block.kind === 'paragraph') {
    (inCell ? cellParagraphs : paragraphs).set(block.paragraphId, dy);
    return shiftParagraph(block, dy);
  }
  return shiftTable(block, dy, paragraphs, cellParagraphs);
}

function shiftParagraph(fragment: ParagraphFragmentRecord, dy: number): ParagraphFragmentRecord {
  const moved = translateParagraphFragment(fragment, 0, dy);
  const pieces = moved.marker?.pieces;
  if (!moved.marker || !pieces) return moved;
  // Right-to-left marker pieces share the marker's coordinate space.
  return {
    ...moved,
    marker: {
      ...moved.marker,
      pieces: pieces.map((piece) => ({ ...piece, box: moveBox(piece.box, dy) })),
    },
  };
}

function shiftTable(
  table: TableFragmentRecord,
  dy: number,
  paragraphs: Map<string, number>,
  cellParagraphs: Map<string, number>
): TableFragmentRecord {
  return {
    ...table,
    box: moveBox(table.box, dy),
    rows: table.rows.map((row) => ({
      ...row,
      box: moveBox(row.box, dy),
      cells: row.cells.map((cell) => ({
        ...cell,
        box: moveBox(cell.box, dy),
        blocks: cell.blocks.map((block) => shiftBlock(block, dy, paragraphs, cellParagraphs, true)),
      })),
    })),
  };
}
