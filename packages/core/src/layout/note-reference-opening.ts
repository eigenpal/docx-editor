import { fragmentOwnsPosition } from './line-segments.ts';
import type { NoteReferenceLineBand } from './note-fragment-geometry.ts';
import { MAX_NOTE_KEEP_SCAN, paragraphKeeps } from './pagination-keeps.ts';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';

/** The smallest body opening that can remain with a paragraph reference. */
export function noteReferenceOpeningBottom(
  page: PageRecord,
  ref: { readonly paragraphId: string; readonly atomOffset: number },
  band: NoteReferenceLineBand
): number {
  if (band.tableRow || !band.evictable) return band.bottom;
  const index = page.fragments.findIndex(
    (block) =>
      block.kind === 'paragraph' && fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)
  );
  const owner = page.fragments[index];
  if (owner?.kind !== 'paragraph') return band.bottom;
  let bottom = band.bottom;
  let previous: ParagraphFragmentRecord | undefined;
  for (let at = index; at < page.fragments.length && at <= index + MAX_NOTE_KEEP_SCAN; at++) {
    const block = page.fragments[at];
    if (block?.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) break;
    if (previous && !paragraphKeeps(previous.props).keepNext) break;
    const lines = block.lines;
    if (!lines.length) break;
    const keeps = paragraphKeeps(block.props);
    let take =
      at === index
        ? lines.findIndex((line) => line.box.y + line.box.height >= band.bottom - 0.001) + 1
        : 1;
    if (take <= 0) break;
    if (keeps.keepLines && block.fragmentIndex === 0 && block.paragraphEnd) take = lines.length;
    else if (keeps.widowControl) {
      take = Math.min(lines.length, Math.max(2, take));
      if (block.paragraphEnd && lines.length - take === 1) take = lines.length;
    }
    const last = lines[take - 1]!;
    const required = last.box.y + last.box.height;
    // Retain the existing escape for body groups that cannot fit on a fresh page.
    if (required - owner.box.y >= page.contentBox.height) break;
    bottom = Math.max(bottom, required);
    if (take < lines.length || !block.paragraphEnd) break;
    previous = block;
  }
  return bottom;
}

/** New paragraph split admission requires one vertically stacked, full-width body column. */
export function paragraphNoteSplitsAllowed(page: PageRecord): boolean {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph' && (fragment.outOfFlow || fragment.positionedFrame)) continue;
    if (fragment.box.y < bottom - 0.001) return false;
    if (fragment.kind === 'paragraph' && fragment.box.width < page.contentBox.width - 0.001)
      return false;
    bottom = fragment.box.y + fragment.box.height;
  }
  return true;
}
