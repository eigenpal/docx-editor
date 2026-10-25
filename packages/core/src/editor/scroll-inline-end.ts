// Keep a left-to-right scroller at its right end while the reader leaves it there.
//
// A right-to-left interface puts a sideways-scrolling review column on the left, so the
// page sits at the scroller's right end. The content keeps growing after the column first
// appears: a navigation shift pads the right edge (and animates), pages paint, zoom changes.
// Each of those moved the right end away from a reader who never scrolled, and the page
// slid under the navigation pane. The reader's own scroll decides whether to follow.

import { hostWindowOf } from './host-realm.ts';

/** How close to the end still counts as "at the end", in CSS pixels. */
const END_SLACK = 1;

/**
 * Scroll `scroller` to its right end, and keep it there while its content or padding
 * changes, until the reader scrolls away from the end. Scrolling back to the end resumes it.
 * Returns the cleanup.
 *
 * @internal
 */
export function keepScrollAtInlineEnd(scroller: HTMLElement): () => void {
  const view = hostWindowOf(scroller);
  const end = () => scroller.scrollWidth - scroller.clientWidth;
  let pinned = true;
  const follow = () => {
    if (pinned) scroller.scrollLeft = end();
  };
  const onScroll = () => {
    pinned = scroller.scrollLeft >= end() - END_SLACK;
  };
  follow();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  // A padding transition changes the size only at its end in some engines; follow it then.
  scroller.addEventListener('transitionend', follow);
  let observer: ResizeObserver | null = null;
  if (typeof view.ResizeObserver === 'function') {
    observer = new view.ResizeObserver(follow);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
  }
  return () => {
    observer?.disconnect();
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('transitionend', follow);
  };
}
