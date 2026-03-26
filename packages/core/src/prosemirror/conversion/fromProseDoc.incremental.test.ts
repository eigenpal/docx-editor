import { describe, it, expect } from 'bun:test';
import { schema } from '../schema';
import { Node as PMNode } from 'prosemirror-model';
import { convertTopLevelNode } from './fromProseDoc';

function buildDoc(texts: string[]): PMNode {
  return schema.node(
    'doc',
    null,
    texts.map((text) => schema.node('paragraph', null, schema.text(text)))
  );
}

describe('convertTopLevelNode', () => {
  it('converts a paragraph node to a Document paragraph', () => {
    const doc = buildDoc(['hello']);
    const para = doc.child(0);
    const block = convertTopLevelNode(para);
    expect(block.type).toBe('paragraph');
  });
});
