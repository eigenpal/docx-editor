// Deleted content leaves the caret space.
//
// Excluding `w:delText` from layout is not enough on its own. If the caret can enter deleted
// content, a user types inside text that exists in neither the original nor the proposal, and
// there is no valid tree for the result. Stepping over a deletion is the same treatment a note
// reference gets.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { caretStops, moveCaret, snapCaretOutOfDeletion } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const del = (id: string, inner: string) =>
  `<w:del w:id="${id}" w:author="Dev" w:date="2026-03-26T11:00:00Z">${inner}</w:del>`;
const ins = (id: string, inner: string) =>
  `<w:ins w:id="${id}" w:author="QA" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;

/** `AB` + deleted `CDE` + `FG` — model offsets 0..7, with 2..5 deleted. */
const MIXED = `<w:p>${run('AB')}${del('1', delRun('CDE'))}${run('FG')}</w:p>`;

function offsets(body: string, mode: RevisionDisplayMode = 'all-markup'): number[] {
  const layout = layoutSemanticDocument(load(body), 1, { measurer, displayMode: mode });
  return caretStops(layout).map((stop) => stop.position.offset);
}

describe('the caret does not enter deleted content', () => {
  test('offsets inside a deletion have no caret stop', () => {
    // 3 and 4 sit between the deleted characters; 2 and 5 are the positions immediately
    // before and after the deletion, which are real places to put a caret.
    expect(offsets(MIXED)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  test('inserted content stays fully addressable', () => {
    // An insertion is live text. Only deletions leave the caret space.
    expect(offsets(`<w:p>${run('AB')}${ins('1', run('CDE'))}${run('FG')}</w:p>`)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  test('a moveFrom is treated as deleted for caret purposes', () => {
    const moved =
      `<w:p>${run('AB')}<w:moveFrom w:id="1" w:author="QA">` +
      `${delRun('CDE')}</w:moveFrom>${run('FG')}</w:p>`;
    expect(offsets(moved)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  test('arrow right steps over the whole deletion in one press', () => {
    const layout = layoutSemanticDocument(load(MIXED), 1, { measurer });
    const paragraphId = caretStops(layout)[0]!.position.paragraphId;
    const moved = moveCaret(layout, { paragraphId, offset: 2 }, 'right');
    expect(moved?.position.offset).toBe(5);
  });

  test('arrow left steps back over it just as cleanly', () => {
    const layout = layoutSemanticDocument(load(MIXED), 1, { measurer });
    const paragraphId = caretStops(layout)[0]!.position.paragraphId;
    const moved = moveCaret(layout, { paragraphId, offset: 5 }, 'left');
    expect(moved?.position.offset).toBe(2);
  });

  test('the rule holds in every display mode', () => {
    // In the proposed result the deleted text is not laid out at all, so its offsets are
    // absent for that reason. In the original it IS laid out, and must still be uneditable:
    // there is no valid tree for text typed inside a deletion.
    expect(offsets(MIXED, 'proposed')).toEqual([0, 1, 2, 5, 6, 7]);
    expect(offsets(MIXED, 'original')).toEqual([0, 1, 2, 5, 6, 7]);
  });

  test('a paragraph that is entirely deleted keeps its boundary caret targets', () => {
    // Both ends survive: the caret can sit before the struck text or after it, which is what
    // makes the paragraph reachable at all — including for the accept or reject that resolves
    // the deletion covering it. Only the eight interior offsets are removed.
    expect(offsets(`<w:p>${del('1', delRun('all gone'))}</w:p>`)).toEqual([0, 8]);
  });

  test('two adjacent deletions are stepped over as one region', () => {
    const body = `<w:p>${run('A')}${del('1', delRun('BC'))}${del('2', delRun('DE'))}${run('F')}</w:p>`;
    expect(offsets(body)).toEqual([0, 1, 5, 6]);
  });
});

describe('a caret left inside a deletion is not a dead end', () => {
  // A gesture can still RESOLVE to an interior offset — the browser reports the struck
  // character a click or drag endpoint landed on. The surface snaps a collapsed caret out
  // (`snapCaretOutOfDeletion`), and navigation resolves rather than refusing, so neither
  // lane depends on the other having run.
  const layout = layoutSemanticDocument(load(MIXED), 1, { measurer });
  const paragraphId = caretStops(layout)[0]!.position.paragraphId;

  test('arrow right resolves to the stop past the deletion', () => {
    expect(moveCaret(layout, { paragraphId, offset: 3 }, 'right')?.position.offset).toBe(5);
  });

  test('arrow left resolves to the stop before it', () => {
    expect(moveCaret(layout, { paragraphId, offset: 4 }, 'left')?.position.offset).toBe(2);
  });

  test('the snap moves an interior caret to the start of the deleted region', () => {
    expect(snapCaretOutOfDeletion(layout, { paragraphId, offset: 3 })).toEqual({
      paragraphId,
      offset: 2,
    });
  });

  test('the snap leaves boundaries and live text where they are', () => {
    for (const offset of [0, 2, 5, 7]) {
      expect(snapCaretOutOfDeletion(layout, { paragraphId, offset }).offset).toBe(offset);
    }
  });

  test('a deletion that wraps across lines is ONE region, not one per line', () => {
    // `LineRecord.deletedRanges` is clipped per line, so a wrapping deletion publishes one
    // slice per line and every wrap boundary looks like a range edge. Read per line, those
    // false edges were caret stops in the middle of struck text — and a keystroke there
    // landed inside the `w:del`.
    const long = 'word '.repeat(40).trimEnd(); // 199 chars, wraps at the fixed 6pt advance
    const body = `<w:p>${run('AB ')}${del('1', delRun(long))}${run('YZ')}</w:p>`;
    const wrapped = layoutSemanticDocument(load(body), 1, { measurer });
    const id = caretStops(wrapped)[0]!.position.paragraphId;
    const all = caretStops(wrapped).map((stop) => stop.position.offset);
    expect(all.filter((offset) => offset > 3 && offset < 3 + long.length)).toEqual([]);
    expect(moveCaret(wrapped, { paragraphId: id, offset: 3 }, 'right')?.position.offset).toBe(
      3 + long.length
    );
    expect(snapCaretOutOfDeletion(wrapped, { paragraphId: id, offset: 100 })).toEqual({
      paragraphId: id,
      offset: 3,
    });
  });

  test('word navigation steps over a deletion instead of targeting its interior', () => {
    // The word walk reads the paragraph text, which includes deleted characters, so a word
    // boundary can land inside a deletion — where the surface's collapsed-caret snap would
    // bounce it straight back: a permanently dead key.
    const body = `<w:p>${run('AB ')}${del('1', delRun('CD EF '))}${run('GH')}</w:p>`;
    const words = layoutSemanticDocument(load(body), 1, { measurer });
    const id = caretStops(words)[0]!.position.paragraphId;
    expect(moveCaret(words, { paragraphId: id, offset: 3 }, 'wordRight')?.position.offset).toBe(9);
    expect(moveCaret(words, { paragraphId: id, offset: 9 }, 'wordLeft')?.position.offset).toBe(3);
  });

  test('nested revisions form one region for both the walk and the snap', () => {
    // `w:ins` wrapping `w:del` twice over, the shape a second reviewer striking a first
    // reviewer's insertions writes: AB + ins(del CD) + ins(del EF) + GH, deleted 2..6.
    const nested =
      `<w:p>${run('AB')}${ins('1', del('2', delRun('CD')))}` +
      `${ins('3', del('4', delRun('EF')))}${run('GH')}</w:p>`;
    const nestedLayout = layoutSemanticDocument(load(nested), 1, { measurer });
    const id = caretStops(nestedLayout)[0]!.position.paragraphId;
    expect(offsets(nested)).toEqual([0, 1, 2, 6, 7, 8]);
    expect(moveCaret(nestedLayout, { paragraphId: id, offset: 4 }, 'right')?.position.offset).toBe(
      6
    );
    expect(moveCaret(nestedLayout, { paragraphId: id, offset: 4 }, 'left')?.position.offset).toBe(
      2
    );
    expect(snapCaretOutOfDeletion(nestedLayout, { paragraphId: id, offset: 4 }).offset).toBe(2);
  });
});
