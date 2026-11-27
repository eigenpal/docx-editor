// The left origin of a continued section on the sheet it shares.
//
// A section that starts with `w:type="continuous"` (CT_SectType, ST_SectionMark; ECMA-376
// Part 1, 17.6.22 and 17.18.77) begins on the paragraph after the previous section, on the same
// sheet. Its `w:pgMar` (CT_PageMar, 17.6.11) still gives the left edge of its own text extents:
// `w:left` applies from the section's first line, not from its next sheet. Its paragraphs,
// tables, indents, columns, text frames, and floating tables all measure from that edge.
//
// The section is laid out against its own geometry, so its records are relative to its own
// content box. The host sheet keeps the content box of the section that opened it, with the
// header, the footer, and the footnote area. Joining the two is a change of origin: every
// record of the continued section moves by the difference between the two left margins.

import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import { translateParagraphFragment } from './paragraph-frame.ts';
import type { BlockFragmentRecord, LayoutBox, PageRecord } from './semantic-records.ts';

/** Below this, in points, the two sections share one left margin. */
const SAME_ORIGIN_PT = 0.000_1;

/**
 * How far, in points, the content of `continued` moves to sit at its own left margin on
 * `host`. Positive when the continued section has the wider left margin.
 */
export function continuedOriginShiftPt(host: PageRecord, continued: PageRecord): number {
  const hostLeft = host.contentBox.x - host.box.x;
  const ownLeft = continued.contentBox.x - continued.box.x;
  const shift = ownLeft - hostLeft;
  return Number.isFinite(shift) && Math.abs(shift) > SAME_ORIGIN_PT ? shift : 0;
}

function moveBox(box: LayoutBox, dx: number): LayoutBox {
  return { ...box, x: box.x + dx };
}

/**
 * `blocks` moved by `dx` along the inline axis, with every box they publish: lines, spans,
 * list markers and their right-to-left pieces, borders, shading, inline drawings, text frames,
 * table rows, cells, and the blocks nested in cells. Cell borders and column edges are relative
 * to their cell and table, and tab stops to their paragraph, so they stay as they are.
 */
export function translateBlocksX(
  blocks: readonly BlockFragmentRecord[],
  dx: number
): readonly BlockFragmentRecord[] {
  if (dx === 0) return blocks;
  return blocks.map((block): BlockFragmentRecord => {
    if (block.kind === 'table') {
      return {
        ...block,
        box: moveBox(block.box, dx),
        rows: block.rows.map((row) => ({
          ...row,
          box: moveBox(row.box, dx),
          cells: row.cells.map((cell) => ({
            ...cell,
            box: moveBox(cell.box, dx),
            blocks: translateBlocksX(cell.blocks, dx),
          })),
        })),
      };
    }
    const moved = translateParagraphFragment(block, dx, 0);
    const pieces = moved.marker?.pieces;
    if (!moved.positionedFrame && !pieces) return moved;
    return {
      ...moved,
      // Right-to-left marker pieces share the marker's coordinate space.
      ...(moved.marker && pieces
        ? {
            marker: {
              ...moved.marker,
              pieces: pieces.map((piece) => ({ ...piece, box: moveBox(piece.box, dx) })),
            },
          }
        : {}),
      ...(moved.positionedFrame
        ? {
            positionedFrame: {
              ...moved.positionedFrame,
              box: moveBox(moved.positionedFrame.box, dx),
            },
          }
        : {}),
    };
  });
}

/** An anchored drawing moved by `dx`, with the frame origin its offsets are measured from. */
function translateAnchoredDrawingX(
  drawing: AnchoredDrawingRecord,
  dx: number
): AnchoredDrawingRecord {
  const moved = shiftAnchoredDrawing(drawing, dx, 0);
  return Object.freeze({
    ...moved,
    horizontalFrameOrigin: moved.horizontalFrameOrigin + dx,
    ...(moved.horizontalPageLeft !== undefined
      ? { horizontalPageLeft: moved.horizontalPageLeft + dx }
      : {}),
  });
}

interface HostedContent {
  readonly shift: number;
  readonly fragments: readonly BlockFragmentRecord[];
  readonly columnSeparators: readonly LayoutBox[] | undefined;
  readonly anchoredDrawings: readonly AnchoredDrawingRecord[] | undefined;
}

// A section whose pass placed nothing hands back the same page record, and the host's left
// margin rarely changes. One entry per record keeps the moved records identical across passes,
// which is what paint and the page-field finalize compare.
const hostedContentMemo = new WeakMap<PageRecord, HostedContent>();

/** The content of `continued` in the coordinates of a host whose content moved it by `shift`. */
function hostedContent(continued: PageRecord, shift: number): HostedContent {
  const memo = hostedContentMemo.get(continued);
  if (memo && memo.shift === shift) return memo;
  const hosted: HostedContent =
    shift === 0
      ? {
          shift,
          fragments: continued.fragments,
          columnSeparators: continued.columnSeparators,
          anchoredDrawings: continued.anchoredDrawings,
        }
      : {
          shift,
          fragments: translateBlocksX(continued.fragments, shift),
          columnSeparators: continued.columnSeparators?.map((box) => moveBox(box, shift)),
          anchoredDrawings: continued.anchoredDrawings?.map((drawing) =>
            translateAnchoredDrawingX(drawing, shift)
          ),
        };
  hostedContentMemo.set(continued, hosted);
  return hosted;
}

/**
 * Append a continued section's first-page content to the sheet it continues.
 *
 * The content already carries offsets past the host page's used height (the section was laid
 * out with `flowStartY` and the host's own content insets), so the block axis is a
 * concatenation. The inline axis moves by {@link continuedOriginShiftPt}: the continued
 * section keeps its own `w:pgMar/@w:left` (17.6.11) on the shared sheet (17.6.22). The host
 * page keeps its own furniture and content box: the header, the footer, and the footnote area
 * belong to the sheet, and the continued section contributes content to it, not chrome.
 */
export function withContinuedSectionContent(page: PageRecord, continued: PageRecord): PageRecord {
  if (
    continued.fragments.length === 0 &&
    !continued.columnSeparators?.length &&
    !continued.anchoredDrawings?.length
  ) {
    return page;
  }
  const hosted = hostedContent(continued, continuedOriginShiftPt(page, continued));
  const anchoredDrawings =
    page.anchoredDrawings || hosted.anchoredDrawings
      ? Object.freeze([...(page.anchoredDrawings ?? []), ...(hosted.anchoredDrawings ?? [])])
      : undefined;
  return {
    ...page,
    fragments:
      hosted.fragments.length > 0 ? [...page.fragments, ...hosted.fragments] : page.fragments,
    ...((page.columnSeparators?.length || hosted.columnSeparators?.length) && {
      columnSeparators: [...(page.columnSeparators ?? []), ...(hosted.columnSeparators ?? [])],
    }),
    ...(anchoredDrawings ? { anchoredDrawings } : {}),
  };
}
