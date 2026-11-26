// Moving a finished page to the side its page number gives it.
//
// A section with mirrored side margins (`w:mirrorMargins`, CT_OnOff, ECMA-376 Part 1
// §17.15.1.57) or a gutter on facing pages (`w:pgMar/@w:gutter`, CT_PageMar, §17.6.11) puts
// the content box of an even page at a different distance from the sheet edge. The body pass
// decides the side from the number a page has there. A sheet the notes pass inserts in front
// of a page moves its number, and an odd move puts the page on the other side.
//
// Body fragments, anchored drawings, column separators and content-control boundaries are
// relative to the content box, so they travel with it. Only the records that hold sheet
// coordinates are translated here. A drawing positioned from the page edge keeps its distance
// to the text, not to the sheet: the body pass resolved it against the earlier side.

import type { OverflowPageShell } from './page-furniture-insets.ts';
import type { LayoutBox, NoteAreaRecord, PageRecord } from './semantic-records.ts';

/** Points; well under any visible step, well over float error from offset sums. */
const SIDE_TOLERANCE = 0.001;

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

/**
 * `page` with its content box, header, footer, note areas and page borders on the side
 * `shell` resolves, or `page` itself when it is there already or the shell names no side.
 */
export function pageOnShellSide(page: PageRecord, shell: OverflowPageShell): PageRecord {
  if (shell.contentLeft === undefined) return page;
  const dx = page.box.x + shell.contentLeft - page.contentBox.x;
  if (Math.abs(dx) <= SIDE_TOLERANCE) return page;
  const { pageBorders: _, ...rest } = page;
  return {
    ...rest,
    contentBox: { ...page.contentBox, x: page.contentBox.x + dx },
    ...(shell.pageBorders ? { pageBorders: shell.pageBorders } : {}),
    ...(page.header
      ? { header: { ...page.header, box: { ...page.header.box, x: page.header.box.x + dx } } }
      : {}),
    ...(page.footer
      ? { footer: { ...page.footer, box: { ...page.footer.box, x: page.footer.box.x + dx } } }
      : {}),
    ...(page.footnotes ? { footnotes: moveNoteArea(page.footnotes, dx) } : {}),
    ...(page.endnotes ? { endnotes: moveNoteArea(page.endnotes, dx) } : {}),
  };
}
