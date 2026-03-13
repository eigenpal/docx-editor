import { describe, it, expect } from 'bun:test';
import { schema } from '../schema';
import { Node as PMNode } from 'prosemirror-model';
import { fromProseDoc, convertTopLevelNode } from './fromProseDoc';
import { mergeDocumentBlocks } from './mergeDocumentBlocks';

function buildDoc(texts: string[]): PMNode {
  return schema.node(
    'doc',
    null,
    texts.map((text) => schema.node('paragraph', null, schema.text(text)))
  );
}

describe('incremental conversion merge', () => {
  it('matches full conversion for single paragraph change', () => {
    const doc1 = buildDoc(['one', 'two']);
    const base = fromProseDoc(doc1 as any, { package: { document: { content: [] } } } as any);

    const doc2 = buildDoc(['one', 'two!']);
    const updated = convertTopLevelNode(doc2.child(1));
    const merged = mergeDocumentBlocks(base, new Map([[1, updated as any]]), 2);
    const full = fromProseDoc(doc2 as any, base);
    expect(merged.package.document.content).toEqual(full.package.document.content);
  });
});
