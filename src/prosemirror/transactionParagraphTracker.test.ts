import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema';
import { getEditedParagraphIdsFromTransaction } from './transactionParagraphTracker';

function createState(): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { paraId: 'AAAA1111' }, [schema.text('Alpha')]),
    schema.node('paragraph', { paraId: 'BBBB2222' }, [schema.text('Beta')]),
  ]);
  return EditorState.create({ doc });
}

function findParagraphRange(doc: PMNode, paraId: string) {
  let from = -1;
  let to = -1;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') {
      return true;
    }
    if (node.attrs?.paraId === paraId) {
      from = pos + 1;
      to = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });

  if (from < 0 || to < 0) {
    throw new Error(`Paragraph not found: ${paraId}`);
  }

  return { from, to };
}

describe('getEditedParagraphIdsFromTransaction', () => {
  test('captures the edited paragraph for text insertion', () => {
    const state = createState();
    const firstParagraph = findParagraphRange(state.doc, 'AAAA1111');
    const tr = state.tr.insertText('X', firstParagraph.from + 1, firstParagraph.from + 1);
    const nextState = state.apply(tr);

    const changed = getEditedParagraphIdsFromTransaction(tr, nextState);

    expect(changed).toContain('AAAA1111');
    expect(changed).not.toContain('BBBB2222');
  });

  test('captures both paragraphs when edit spans paragraph boundary', () => {
    const state = createState();
    const firstParagraph = findParagraphRange(state.doc, 'AAAA1111');
    const secondParagraph = findParagraphRange(state.doc, 'BBBB2222');
    const tr = state.tr.delete(firstParagraph.to - 1, secondParagraph.from + 1);
    const nextState = state.apply(tr);

    const changed = getEditedParagraphIdsFromTransaction(tr, nextState);

    expect(changed).toContain('AAAA1111');
    expect(changed).toContain('BBBB2222');
  });
});
