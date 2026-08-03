// Deleted content leaves the caret space.
//
// Excluding `w:delText` from layout is not enough on its own. If the caret can enter deleted
// content, a user types inside text that exists in neither the original nor the proposal, and
// there is no valid tree for the result. Stepping over a deletion is the same treatment a note
// reference gets.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { caretStops, moveCaret } from '../semantic-interaction.ts';
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
