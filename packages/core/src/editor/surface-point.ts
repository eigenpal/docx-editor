import type { PointerHost, SurfacePointHit } from './surface-pointer.ts';
import {
  pageAtY,
  hitTestFragments,
  hitTestPage,
  type SemanticHit,
} from '../layout/semantic-hit-test.ts';
import {
  findNoteAtSheetPoint,
  findStoryAtSheetPoint,
  isBodyContentPoint,
  storyMatchesBinding,
  hitTestStoryAtLocalPoint,
  storyHitYieldsToBody,
} from './surface-scope.ts';

/** Strict point reads inspect one page and never change the active selection. */
export function surfacePointAt(
  host: PointerHost,
  clientX: number,
  clientY: number
): SurfacePointHit | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !host.pagesLayer.isConnected)
    return null;
  // Public reads do not retain a gesture's DOM origin across host layout changes.
  const pagesLayer = host.pagesLayer;
  const layout = host.layout();
  const rect = pagesLayer.getBoundingClientRect();
  const scale = host.scale() || 1;
  const sheet = { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  const index = pageAtY(layout, sheet.y);
  const page = layout.pages[index];
  if (!page) return null;
  const x = sheet.x - host.pageOffsetX(index);
  const box = page.box;
  if (x < box.x || x >= box.x + box.width || sheet.y < box.y || sheet.y >= box.y + box.height)
    return null;
  const pageLayout = { ...layout, pages: [page] };
  const options = host.measurer() ? { measurer: host.measurer()! } : {};
  let origin = { x: page.contentBox.x + host.pageOffsetX(index), y: page.contentBox.y };
  let hit: SemanticHit | null;
  const activeNote = host.activeNote?.();
  const activeStory = host.activeHeaderFooter?.();
  if (activeNote) {
    const note = findNoteAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (!note || note.scopeId !== activeNote.scopeId) return null;
    origin = { x: sheet.x - note.local.x, y: sheet.y - note.local.y };
    hit = hitTestFragments(layout, index, note.fragments, note.local, options);
  } else if (activeStory) {
    if (index !== activeStory.pageIndex) return null;
    const story = findStoryAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (
      !story ||
      !storyMatchesBinding(story.story, {
        scope: { kind: 'headerFooter', rId: activeStory.rId },
        ...activeStory,
      })
    )
      return null;
    origin = { x: sheet.x - story.local.x, y: sheet.y - story.local.y };
    hit = hitTestStoryAtLocalPoint(layout, index, story.story, story.local, options);
  } else {
    if (!isBodyContentPoint(layout, sheet, host.pageOffsetX)) return null;
    if (findNoteAtSheetPoint(pageLayout, sheet, host.pageOffsetX)) return null;
    const story = findStoryAtSheetPoint(pageLayout, sheet, host.pageOffsetX);
    if (
      story &&
      !storyHitYieldsToBody(layout, story, sheet, host.pageOffsetX, false, options.measurer)
    )
      return null;
    hit = hitTestPage(layout, index, { x: sheet.x - origin.x, y: sheet.y - origin.y }, options);
  }
  if (
    !hit ||
    hit.pageIndex !== index ||
    host.isReadOnlyPosition?.(hit.position) ||
    host.isReadOnlyParagraph?.(hit.position.paragraphId)
  )
    return null;
  return { hit, x: origin.x + hit.caret.x, y: origin.y + hit.caret.y };
}
