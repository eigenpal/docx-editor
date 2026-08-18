// Giving a merged paragraph's content back its own identity.
//
// A resolved display mode lays a run of paragraphs out as one, because that is what the
// document becomes once its tracked decisions are taken. The layout is right and the identity
// is not: every span in that fragment names the paragraph the merge kept, at an offset in a
// paragraph that does not hold those characters. A resolved view is EDITABLE — the free engine
// renders `proposed` by default — so a click or a keystroke in the merged half would address a
// position the store does not have.
//
// This maps each published range back to the member that contributed it. The member boundaries
// are the members' own model lengths: `piecesOfParagraph` keeps its running offset aligned with
// `paragraphTextOf`, which is the same authority `paragraphOffsetIndex` answers from, so the
// k-th member starts at the sum of the lengths before it.

import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import type { ParagraphMergeGroup } from './story-roots.ts';
import type { LineRecord, SourceRange, StyleSpanRecord } from './semantic-records.ts';

interface MergeMember {
  readonly paragraphId: string;
  /** Where this member's content starts in the merged paragraph's offsets. */
  readonly base: number;
  readonly length: number;
}

export interface MergeBoundaries {
  readonly members: readonly MergeMember[];
  readonly total: number;
}

/** Member bases, in the merged paragraph's own offset space. */
export function mergeBoundariesOf(group: ParagraphMergeGroup): MergeBoundaries {
  const members: MergeMember[] = [];
  let base = 0;
  for (const member of group.members) {
    const length = paragraphOffsetIndex(member as OoxmlParagraphNode).length;
    members.push({ paragraphId: member.id, base, length });
    base += length;
  }
  return { members, total: base };
}

/**
 * The member an offset belongs to.
 *
 * The LAST member whose content starts at or before the offset, which puts a position at a
 * member boundary — the caret between the two halves — at the start of the following member,
 * where an insertion belongs to the paragraph the reader is typing into. An empty member has
 * zero length and no offset of its own, so it never wins.
 */
function memberAt(boundaries: MergeBoundaries, offset: number): MergeMember | undefined {
  let found: MergeMember | undefined;
  for (const member of boundaries.members) {
    if (member.base > offset) break;
    if (found === undefined || member.length > 0 || member.base > found.base) found = member;
  }
  return found ?? boundaries.members[boundaries.members.length - 1];
}

function remapRange(range: SourceRange, boundaries: MergeBoundaries): SourceRange {
  const member = memberAt(boundaries, range.start);
  if (!member) return range;
  const end = range.end - member.base;
  return {
    paragraphId: member.paragraphId,
    start: range.start - member.base,
    // A span is a piece of ONE run and two members contribute different runs, so a span cannot
    // cross a boundary. The clamp is what keeps a broken invariant from publishing an offset
    // past the end of a real paragraph, where an edit would be refused or land elsewhere.
    end: Math.min(end, member.length),
  };
}

function remapSpan(span: StyleSpanRecord, boundaries: MergeBoundaries): StyleSpanRecord {
  return { ...span, range: remapRange(span.range, boundaries) };
}

/**
 * Every range a merged fragment publishes, in the offsets of the paragraph that owns it.
 *
 * A line keeps ONE range, because that is the shape every consumer reads; it names the
 * paragraph of the line's first span. The join line therefore belongs to two paragraphs and
 * says so only through its spans, which is why the interaction index reads spans rather than
 * the line range when it maps a position.
 */
export function remapMergedLines(
  lines: readonly LineRecord[],
  boundaries: MergeBoundaries
): readonly LineRecord[] {
  return lines.map((line) => {
    const spans = line.spans.map((span) => remapSpan(span, boundaries));
    const first = spans[0];
    const range = first
      ? { paragraphId: first.range.paragraphId, start: first.range.start, end: 0 }
      : remapRange(line.range, boundaries);
    const last = spans[spans.length - 1];
    const lineRange: SourceRange = first
      ? {
          paragraphId: range.paragraphId,
          start: range.start,
          // The end of the LAST span that shares the line's paragraph, so a join line reports
          // the extent it holds of the paragraph it names rather than the other one's.
          end: (last && last.range.paragraphId === range.paragraphId ? last.range : first.range)
            .end,
        }
      : range;
    const drawings = line.drawings?.map((drawing) => {
      const member = memberAt(boundaries, drawing.start);
      return member
        ? { ...drawing, paragraphId: member.paragraphId, start: drawing.start - member.base }
        : drawing;
    });
    // A deleted range is a pair of offsets with no paragraph of its own, so on a join line it
    // can only be expressed in one paragraph's terms. Kept for the paragraph the line names and
    // dropped for the other — and in practice empty either way, because a mode that merges has
    // already resolved every deletion: `proposed` hides the text, `original` keeps it as live.
    const deletedRanges = line.deletedRanges
      ?.map((deleted) => ({ deleted, member: memberAt(boundaries, deleted.start) }))
      .filter(({ member }) => member?.paragraphId === lineRange.paragraphId)
      .map(({ deleted, member }) => ({
        start: deleted.start - (member?.base ?? 0),
        end: deleted.end - (member?.base ?? 0),
      }));
    return {
      ...line,
      range: lineRange,
      spans,
      ...(drawings ? { drawings } : {}),
      ...(deletedRanges ? { deletedRanges } : {}),
    };
  });
}
