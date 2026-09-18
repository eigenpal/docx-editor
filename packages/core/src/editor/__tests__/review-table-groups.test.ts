import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '../../store/index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../../store/__tests__/fixtures/review-table-grouping-cases.ts';
function mount(name: string) {
  const c = reviewTableGroupingCases.find((c) => c.name === name)!;
  const container = document.createElement('div');
  document.body.append(container);
  return createDocxEditor({
    container,
    author: 'Ada',
    document: zipSync(
      Object.fromEntries(
        Object.entries(reviewTableGroupingParts(c)).map(([key, value]) => [key, strToU8(value)])
      )
    ),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, id) => {
            const paragraph = findNode(part, id);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
    ],
  });
}
for (const name of ['nested-two-rows-ins', 'nested-following-gap-ins']) {
  test(`${name} places nested row boundaries after independent cell text`, () => {
    const editor = mount(name);
    try {
      const items = editor.getReviewItems({ placement: false });
      expect(
        items.map((item) => (item.kind === 'revision' ? item.revisionKind : item.kind))
      ).toEqual(
        name === 'nested-two-rows-ins'
          ? ['insert', 'insert', 'structural', 'insert', 'structural']
          : ['insert', 'insert', 'structural', 'insert']
      );
    } finally {
      editor.destroy();
    }
  });
}
for (const command of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  test(`${command} resolves an ordinary move while keeping its independent insertion`, () => {
    const editor = mount('move-range-pair');
    try {
      const before = editor.getReviewItems({ placement: false });
      expect(before).toHaveLength(4);
      const move = before.find(
        (entry) => entry.item.kind === 'revision' && entry.item.revisionKind === 'moveTo'
      )!;
      expect(editor[command](move.key).ok).toBe(true);
      const after = editor.getReviewItems({ placement: false });
      expect(after).toHaveLength(1);
      expect(after[0]!.item).toMatchObject({ revisionKind: 'insert', text: 'Moved' });
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).map((item) => item.key)).toEqual(
        before.map((item) => item.key)
      );
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
  test(`${command} preflights single-site row dependencies`, () => {
    const editor = mount(
      command === 'acceptReviewItem' ? 'nested-following-gap-del' : 'nested-following-gap-ins'
    );
    try {
      const before = editor.getReviewItems({ placement: false });
      const row = before.find((item) => item.key.includes('revision-structural'))!;
      expect(row).toBeDefined();
      expect(editor[command](row.key).ok).toBe(false);
      expect(editor.getReviewItems({ placement: false }).map((item) => item.key)).toEqual(
        before.map((item) => item.key)
      );
    } finally {
      editor.destroy();
    }
  });
  for (const name of ['format-row-and-cells', 'adjacent-format-different-baseline']) {
    test(`${command} resolves ${name} atomically with undo and redo`, () => {
      const editor = mount(name);
      try {
        const before = editor.getReviewItems({ placement: false });
        expect(before).toHaveLength(1);
        expect(editor[command](before[0]!.key).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
        expect(editor.exec({ type: 'undo' }).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false }).map((item) => item.key)).toEqual(
          before.map((item) => item.key)
        );
        expect(editor.exec({ type: 'redo' }).ok).toBe(true);
        expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
      } finally {
        editor.destroy();
      }
    });
  }
  test(`${command} resolves a table group in one undoable action`, () => {
    const editor = mount('paragraph-marks-ins');
    try {
      const before = editor.getReviewItems({ placement: false });
      expect(before).toHaveLength(1);
      expect(editor[command](before[0]!.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).map((i) => i.key)).toEqual(
        before.map((i) => i.key)
      );
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false })).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
}
test('editing any grouped cell refreshes the full structural decision', () => {
  const editor = mount('two-rows-ins');
  try {
    const initial = editor.getReviewItems({ placement: false })[0]!;
    if (initial.item.kind !== 'revision') throw Error('Expected revision');
    const ranges = initial.item.ranges;
    expect(ranges).toHaveLength(4);
    const end = ranges[3]!.end;
    expect(
      editor.surface!.session.applyTreeOps([
        { op: 'insertText', paragraphId: end.paragraphId, offset: end.offset, text: 'Updated' },
      ]).committed
    ).toBe(true);
    const refreshed = editor.getReviewItems({ placement: false });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]!.key).toBe(initial.key);
    expect(refreshed[0]!.text).toContain('Updated');
  } finally {
    editor.destroy();
  }
});
test('independent deletion stays selectable beside the table group', () => {
  const editor = mount('row-insert-with-deletion');
  try {
    const items = editor.getReviewItems({ placement: false });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(editor.setActiveReviewItem(item.key).ok).toBe(true);
      expect(editor.getReviewItems({ placement: false }).find((i) => i.isActive)?.key).toBe(
        item.key
      );
    }
  } finally {
    editor.destroy();
  }
});
