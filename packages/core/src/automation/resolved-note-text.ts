import { createFixedMeasurer } from '../layout/index.ts';
import { lineSegments } from '../layout/line-segments.ts';
import { layoutNoteById } from '../layout/note-layout.ts';
import {
  paragraphFragmentsOfBlocks,
  type BlockFragmentRecord,
} from '../layout/semantic-records.ts';
import { PARAGRAPH_MARK, type AutomationStoryReads } from './reads.ts';

function noteDisplayParagraphGroups(
  fragments: readonly BlockFragmentRecord[]
): readonly { readonly paragraphId: string; readonly mergedWithPrevious: boolean }[] {
  const groups: { paragraphId: string; mergedWithPrevious: boolean }[] = [];
  const seen = new Set<string>();
  for (const fragment of paragraphFragmentsOfBlocks(fragments)) {
    let firstInFragment = true;
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line)) {
        if (seen.has(segment.paragraphId)) continue;
        seen.add(segment.paragraphId);
        groups.push({
          paragraphId: segment.paragraphId,
          mergedWithPrevious: !firstInFragment,
        });
        firstInFragment = false;
      }
    }
    if (fragment.lines.length === 0 || seen.has(fragment.paragraphId)) continue;
    seen.add(fragment.paragraphId);
    groups.push({
      paragraphId: fragment.paragraphId,
      mergedWithPrevious: !firstInFragment,
    });
  }
  return groups;
}

function visibleNoteParagraphText(
  fragments: readonly BlockFragmentRecord[],
  paragraphId: string
): string {
  const pieces: { start: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const fragment of paragraphFragmentsOfBlocks(fragments)) {
    for (const line of fragment.lines) {
      for (const segment of lineSegments(line)) {
        if (segment.paragraphId !== paragraphId) continue;
        for (const span of segment.spans) {
          if (span.range.end === span.range.start) continue;
          const key = `${span.range.start}:${span.range.end}:${span.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pieces.push({ start: span.range.start, text: span.text });
        }
      }
    }
  }
  return pieces
    .sort((left, right) => left.start - right.start)
    .map((piece) => piece.text)
    .join('');
}

export function resolvedNoteText(
  reads: AutomationStoryReads,
  displayMode: 'proposed' | 'original'
): string {
  const story = reads.story;
  if (story.kind !== 'note') return reads.text();
  const laid = layoutNoteById(reads.part, story.noteId, 400, {
    measurer: createFixedMeasurer(),
    producer: 'automation:resolved-note-text',
    displayMode,
  });
  if (!laid) return reads.text();
  const groups = noteDisplayParagraphGroups(laid.fragments);
  const [first] = groups;
  if (!first) return '';
  let text = visibleNoteParagraphText(laid.fragments, first.paragraphId);
  for (let index = 1; index < groups.length; index += 1) {
    const group = groups[index]!;
    text += `${group.mergedWithPrevious ? '' : PARAGRAPH_MARK}${visibleNoteParagraphText(
      laid.fragments,
      group.paragraphId
    )}`;
  }
  return text;
}
