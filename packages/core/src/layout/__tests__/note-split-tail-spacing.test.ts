// A note paragraph that ends on the continuation page keeps its space after there.
//
// The carried tail of a split footnote lays out like the rest of the note story: the last
// paragraph's `w:spacing/@w:after` (ECMA-376 Part 1, §17.3.1.33) stays between it and the next
// note on the continuation page. The tail height used to stop at the last line's box, so the
// next note rose by that spacing against the reference.
import { describe, expect, test } from 'bun:test';
import { splitNoteFragments } from '../note-splitting.ts';
import type { NoteStoryLayout } from '../note-layout.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const LINE = 12;
const AFTER = 6;
const FULL_COLUMN = LINE * 20;

function paragraph(id: string, top: number, lineCount: number): ParagraphFragmentRecord {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    index: i,
    box: { x: 0, y: top + i * LINE, width: 100, height: LINE },
    baseline: LINE - 3,
    range: { paragraphId: id, start: i * 10, end: i * 10 + 9 },
    spans: [],
  }));
  return {
    kind: 'paragraph',
    id: `${id}#f0`,
    paragraphId: id,
    fragmentIndex: 0,
    paragraphEnd: true,
    props: [{ localName: 'widowControl', attributes: { val: '0' } }],
    range: { paragraphId: id, start: 0, end: lineCount * 10 },
    spacing: { before: 0, after: AFTER },
    box: { x: 0, y: top, width: 100, height: lineCount * LINE },
    lines,
  } as unknown as ParagraphFragmentRecord;
}

/** A footnote story whose flow ends after the last paragraph's space after. */
function story(...fragments: ParagraphFragmentRecord[]): NoteStoryLayout {
  const last = fragments.at(-1)!;
  return {
    noteKind: 'footnote',
    noteId: 2,
    scopeId: 'footnote:2',
    noteType: undefined,
    fragments,
    flowHeight: last.box.y + last.box.height + AFTER,
  } as unknown as NoteStoryLayout;
}

describe('a split note tail keeps the space after its last paragraph', () => {
  test('a paragraph split across pages', () => {
    const split = splitNoteFragments(story(paragraph('p1', 0, 5)), LINE * 3, {
      fullContentHeight: FULL_COLUMN,
    });
    expect(split.headHeight).toBe(LINE * 3);
    expect(split.tailHeight).toBe(LINE * 2 + AFTER);
  });

  test('a split between paragraphs', () => {
    const first = paragraph('p1', 0, 2);
    const second = paragraph('p2', LINE * 2 + AFTER, 3);
    const split = splitNoteFragments(story(first, second), LINE * 2 + AFTER, {
      fullContentHeight: FULL_COLUMN,
    });
    expect(split.head).toEqual([first]);
    expect(split.tailHeight).toBe(LINE * 3 + AFTER);
  });

  test('a tail carried whole again keeps the same height', () => {
    const first = splitNoteFragments(story(paragraph('p1', 0, 5)), LINE * 3, {
      fullContentHeight: FULL_COLUMN,
    });
    const carried = {
      ...story(paragraph('p1', 0, 2)),
      fragments: first.tail,
      flowHeight: first.tailHeight,
    } as NoteStoryLayout;
    const again = splitNoteFragments(carried, FULL_COLUMN, { fullContentHeight: FULL_COLUMN });
    expect(again.headHeight).toBe(LINE * 2 + AFTER);
  });
});
