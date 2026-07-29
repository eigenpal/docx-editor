// Identity rules for split/join/move/replace/delete + undo restoration
// (document-engine task 3.4). Verifies exact ids across forward, undo, redo, and
// reopen (identity-state persistence).

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  insertTextIntoParagraph,
  paragraphText,
  splitParagraph,
  joinParagraphs,
  moveBlock,
  replaceParagraph,
  deleteParagraph,
  restoreParagraph,
  splitRunsAt,
  type ParagraphRecord,
  type PackageModel,
} from '../model/index.ts';

function firstParaId(model: PackageModel): string {
  return (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
}
function blocks(model: PackageModel): ParagraphRecord[] {
  return model.stories.get(bodyStoryId(model))!.blocks as ParagraphRecord[];
}

describe('splitRunsAt', () => {
  test('splits at a char offset inside a run, preserving props', () => {
    const [head, tail] = splitRunsAt([{ text: 'Hello', props: { bold: true } }], 2);
    expect(head).toEqual([{ text: 'He', props: { bold: true } }]);
    expect(tail).toEqual([{ text: 'llo', props: { bold: true } }]);
  });
});

describe('split identity rule', () => {
  test('first fragment keeps id, tail gets a new id; undo restores single original id', () => {
    let model = createEmptyModel();
    const pid = firstParaId(model);
    model = insertTextIntoParagraph(model, pid, 'HelloWorld');

    const split = splitParagraph(model, pid, 5);
    expect(blocks(split.model)[0].id).toBe(pid); // first keeps id
    expect(split.tailId).not.toBe(pid); // tail is new
    expect(paragraphText(split.model, pid)).toBe('Hello');
    expect(paragraphText(split.model, split.tailId)).toBe('World');

    // Undo == join back; the original id survives, single paragraph.
    const undone = joinParagraphs(split.model, pid, split.tailId);
    expect(blocks(undone).map((b) => b.id)).toEqual([pid]);
    expect(paragraphText(undone, pid)).toBe('HelloWorld');

    // Redo the split reusing the recorded tail id -> exact same id.
    const redo = splitParagraph(undone, pid, 5, { tailId: split.tailId });
    expect(redo.tailId).toBe(split.tailId);
  });
});

describe('join identity rule', () => {
  test('first survivor keeps its id, the second id is removed', () => {
    let model = createEmptyModel();
    const p1 = firstParaId(model);
    model = insertTextIntoParagraph(model, p1, 'AB');
    const { model: m2, tailId: p2 } = splitParagraph(model, p1, 1); // p1="A", p2="B"
    const joined = joinParagraphs(m2, p1, p2);
    expect(blocks(joined).map((b) => b.id)).toEqual([p1]);
    expect(blocks(joined).some((b) => b.id === p2)).toBe(false);
  });
});

describe('move retains identity', () => {
  test('reordering blocks preserves every id', () => {
    let model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const p1 = firstParaId(model);
    model = insertTextIntoParagraph(model, p1, 'one');
    const s = splitParagraph(model, p1, 3); // p1="one", tail=""
    const before = blocks(s.model).map((b) => b.id);
    const moved = moveBlock(s.model, storyId, 0, 1);
    expect(blocks(moved).map((b) => b.id)).toEqual([before[1], before[0]]);
  });
});

describe('semantic replacement mints identity', () => {
  test('replace produces a new id distinct from the original', () => {
    let model = createEmptyModel();
    const pid = firstParaId(model);
    model = insertTextIntoParagraph(model, pid, 'old');
    const { model: m2, newId } = replaceParagraph(model, pid, [{ text: 'new' }]);
    expect(newId).not.toBe(pid);
    expect(blocks(m2)[0].id).toBe(newId);
    expect(paragraphText(m2, newId)).toBe('new');
    expect(paragraphText(m2, pid)).toBeUndefined(); // old id gone
  });
});

describe('deletion and undo restoration', () => {
  test('delete then restore recovers the exact id at its index', () => {
    let model = createEmptyModel();
    const p1 = firstParaId(model);
    model = insertTextIntoParagraph(model, p1, 'keep');
    const s = splitParagraph(model, p1, 4); // p1="keep", tail=""
    const tail = s.tailId;

    const del = deleteParagraph(s.model, tail);
    expect(blocks(del.model).some((b) => b.id === tail)).toBe(false);

    const restored = restoreParagraph(del.model, del.storyId, del.index, del.removed);
    expect(blocks(restored).map((b) => b.id)).toEqual([p1, tail]); // exact id, exact index
  });
});

describe('reopen: identity cursor persists so new ids never collide', () => {
  test('a split tail id is not reallocated after reopen', () => {
    let model = createEmptyModel();
    const p1 = firstParaId(model);
    model = insertTextIntoParagraph(model, p1, 'XY');
    const s = splitParagraph(model, p1, 1);
    // "Reopen" == reconstruct from the persisted identity state.
    const reopened: PackageModel = { ...s.model, identity: s.model.identity };
    const s2 = splitParagraph(reopened, p1, 0); // allocate a fresh tail
    expect(s2.tailId).not.toBe(s.tailId); // no collision with the earlier tail
  });
});
