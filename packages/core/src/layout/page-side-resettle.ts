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
import { strippedStoryProjections } from './published-story-projections.ts';
import type {
  HeaderFooterStoryRecord,
  LayoutBox,
  NoteAreaRecord,
  PageRecord,
} from './semantic-records.ts';

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
 */
export function pageOnShellSide(page: PageRecord, shell: OverflowPageShell): PageRecord {
  if (shell.contentLeft === undefined) return page;
  const dx = page.box.x + shell.contentLeft - page.contentBox.x;
  if (Math.abs(dx) <= SIDE_TOLERANCE) return page;
  const { pageBorders: _, header: _header, footer: _footer, ...rest } = page;
  const header = storyOnSide(page.header, shell.header, dx);
  const footer = storyOnSide(page.footer, shell.footer, dx);
  return {
    ...rest,
    contentBox: { ...page.contentBox, x: page.contentBox.x + dx },
    ...(shell.pageBorders ? { pageBorders: shell.pageBorders } : {}),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(page.footnotes ? { footnotes: moveNoteArea(page.footnotes, dx) } : {}),
    ...(page.endnotes ? { endnotes: moveNoteArea(page.endnotes, dx) } : {}),
  };
}
