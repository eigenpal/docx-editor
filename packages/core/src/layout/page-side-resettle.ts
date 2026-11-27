// Moving a finished page to the side its page number gives it.
//
// A section with mirrored side margins (`w:mirrorMargins`, CT_OnOff, ECMA-376 Part 1
// §17.15.1.57) or a gutter on facing pages (`w:pgMar/@w:gutter`, CT_PageMar, §17.6.11) puts
// the content box of an even page at a different distance from the sheet edge. The body pass
// decides the side from the number a page has there. A sheet the notes pass inserts in front
// of a page moves its number, and an odd move puts the page on the other side.
//
// Body fragments, anchored drawings, column separators and content-control boundaries are
// relative to the content box, so they travel with it. The records that hold sheet
// coordinates are translated here. A floating table (`w:tblpPr/@w:horzAnchor="page"`,
// CT_TblPPr, §17.4.57) or an anchored drawing (`wp:positionH/@relativeFrom="page"`,
// ST_RelFromH, §20.4.3.4) positioned from the page edge is moved back, so it keeps its
// distance to the sheet. The body lines keep the wrap the body pass gave them, and a text
// frame (`w:framePr`) and an object in a margin band keep their distance to the text.

import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import type { OverflowPageShell } from './page-furniture-insets.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import { strippedStoryProjections } from './published-story-projections.ts';
import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  NoteAreaRecord,
  PageRecord,
} from './semantic-records.ts';

/** Points; well under any visible step, well over float error from offset sums. */
const SIDE_TOLERANCE = 0.001;
const NO_TABLES: ReadonlySet<string> = new Set();

function moveNoteArea(area: NoteAreaRecord, dx: number): NoteAreaRecord {
  const move = (box: LayoutBox): LayoutBox => ({ ...box, x: box.x + dx });
  return {
    ...area,
    box: move(area.box),
    ...(area.separator ? { separator: { ...area.separator, box: move(area.separator.box) } } : {}),
    ...(area.continuationNotice
      ? {
          continuationNotice: {
            ...area.continuationNotice,
            box: move(area.continuationNotice.box),
          },
        }
      : {}),
    notes: area.notes.map((note) => ({ ...note, box: move(note.box) })),
  };
}

/** `block` and every box in it, `dx` points sideways; `held` collects its paragraph ids. */
function blockMovedSideways(
  block: BlockFragmentRecord,
  dx: number,
  held: Set<string>
): BlockFragmentRecord {
  if (block.kind === 'paragraph') {
    held.add(block.paragraphId);
    return translateParagraphFragment(block, dx, 0);
  }
  const move = (box: LayoutBox): LayoutBox => ({ ...box, x: box.x + dx });
  return {
    ...block,
    box: move(block.box),
    rows: block.rows.map((row) => ({
      ...row,
      box: move(row.box),
      cells: row.cells.map((cell) => ({
        ...cell,
        box: move(cell.box),
        blocks: cell.blocks.map((inner) => blockMovedSideways(inner, dx, held)),
      })),
    })),
  };
}

/**
 * The ids of the body tables positioned from the page edge. Only one fragment of a table
 * that continues over pages carries its position, so the answer is for all `pages` together.
 */
export function pageEdgeTableIds(pages: readonly PageRecord[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const page of pages)
    for (const fragment of page.fragments)
      if (fragment.kind === 'table' && fragment.floatingWrap?.float.horzAnchor === 'page')
        ids.add(fragment.tableId);
  return ids;
}

/** Adds the id of every paragraph in the cells of `block` to `ids`. */
function collectCellParagraphs(block: BlockFragmentRecord, ids: Set<string>): void {
  if (block.kind === 'paragraph') return void ids.add(block.paragraphId);
  for (const row of block.rows)
    for (const cell of row.cells)
      for (const inner of cell.blocks) collectCellParagraphs(inner, ids);
}

/**
 * The body records of `page` that are positioned from the page edge, moved `dx` points so
 * that they stay where they are on the sheet while the content box moves the other way.
 * Returns nothing when the page holds no such record.
 */
function pageEdgeRecordsHeld(
  page: PageRecord,
  dx: number,
  pageEdgeTables: ReadonlySet<string>
): Pick<PageRecord, 'fragments' | 'anchoredDrawings'> | undefined {
  const held = new Set<string>();
  // Paragraphs in the cells of the tables that travel with the text.
  const inCell = new Set<string>();
  let changed = false;
  const fragments = page.fragments.map((fragment) => {
    if (fragment.kind !== 'table') return fragment;
    if (!pageEdgeTables.has(fragment.tableId)) {
      if (page.anchoredDrawings?.length) collectCellParagraphs(fragment, inCell);
      return fragment;
    }
    changed = true;
    return blockMovedSideways(fragment, dx, held);
  });
  const anchoredDrawings = page.anchoredDrawings?.map((drawing) => {
    // A drawing anchored in a moved table cell goes with its cell. A drawing laid out in a
    // cell that stays with the text is placed from that cell, whatever frame it names.
    const stays = held.has(drawing.anchorParagraphId)
      ? false
      : drawing.horizontalFrame !== 'page' ||
        (drawing.layoutInCell && inCell.has(drawing.anchorParagraphId));
    if (stays) return drawing;
    changed = true;
    return shiftAnchoredDrawing(drawing, dx, 0);
  });
  if (!changed) return undefined;
  return { fragments, ...(anchoredDrawings ? { anchoredDrawings } : {}) };
}

/**
 * `story` on the side `shell` resolves, `dx` points from where it is.
 *
 * The shell lays the same variant out again for the page's new side and number, so its
 * record is the story to show: content positioned from the page edge is resolved against
 * the new side, and its page fields project the new number. A page that keeps another
 * variant than the shell resolves moves that story sideways, with the projector that
 * finalize reads for it (`strippedStoryProjections`).
 */
function storyOnSide(
  story: HeaderFooterStoryRecord | undefined,
  shellStory: HeaderFooterStoryRecord | undefined,
  dx: number
): HeaderFooterStoryRecord | undefined {
  if (!story) return undefined;
  if (shellStory?.variant === story.variant && shellStory.partName === story.partName)
    return shellStory;
  const move = (record: HeaderFooterStoryRecord): HeaderFooterStoryRecord => ({
    ...record,
    box: { ...record.box, x: record.box.x + dx },
  });
  const moved = move(story);
  const live = story.pageFieldProjector;
  if (live) return { ...moved, pageFieldProjector: (context) => move(live(context)) };
  const retained = strippedStoryProjections.get(story);
  if (retained)
    strippedStoryProjections.set(moved, {
      ...retained,
      projector: (context) => move(retained.projector(context)),
    });
  return moved;
}

/**
 * `page` with its content box, header, footer, note areas and page borders on the side
 * `shell` resolves, or `page` itself when it is there already or the shell names no side.
 * Body records positioned from the page edge keep their place on the sheet; `pageEdgeTables`
 * names the tables among them ({@link pageEdgeTableIds}).
 */
export function pageOnShellSide(
  page: PageRecord,
  shell: OverflowPageShell,
  pageEdgeTables: ReadonlySet<string> = NO_TABLES
): PageRecord {
  if (shell.contentLeft === undefined) return page;
  const dx = page.box.x + shell.contentLeft - page.contentBox.x;
  if (Math.abs(dx) <= SIDE_TOLERANCE) return page;
  const { pageBorders: _, header: _header, footer: _footer, ...rest } = page;
  const header = storyOnSide(page.header, shell.header, dx);
  const footer = storyOnSide(page.footer, shell.footer, dx);
  return {
    ...rest,
    ...pageEdgeRecordsHeld(page, -dx, pageEdgeTables),
    contentBox: { ...page.contentBox, x: page.contentBox.x + dx },
    ...(shell.pageBorders ? { pageBorders: shell.pageBorders } : {}),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(page.footnotes ? { footnotes: moveNoteArea(page.footnotes, dx) } : {}),
    ...(page.endnotes ? { endnotes: moveNoteArea(page.endnotes, dx) } : {}),
  };
}
