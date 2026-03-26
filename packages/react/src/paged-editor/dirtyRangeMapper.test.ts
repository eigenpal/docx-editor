import { describe, it, expect } from 'bun:test';
import { mapDirtyRangesToTopLevelIndices } from './dirtyRangeMapper';
import { schema } from '@eigenpal/docx-core/prosemirror/schema';
import { Node as PMNode } from 'prosemirror-model';

function buildDoc(texts: string[]): PMNode {
  return schema.node(
    'doc',
    null,
    texts.map((text) => schema.node('paragraph', null, schema.text(text)))
  );
}

describe('mapDirtyRangesToTopLevelIndices', () => {
  it('maps a range to the correct top-level paragraph index', () => {
    const doc = buildDoc(['one', 'two', 'three']);
    const ranges = [{ from: 2, to: 5 }];
    const result = mapDirtyRangesToTopLevelIndices(doc, ranges);
    expect([...result]).toEqual([0]);
  });

  it('includes multiple indices when range spans blocks', () => {
    const doc = buildDoc(['one', 'two', 'three']);
    const ranges = [{ from: 1, to: doc.content.size }];
    const result = mapDirtyRangesToTopLevelIndices(doc, ranges);
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });
});
