/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { expect, test } from 'bun:test';
import { DocumentRegistry } from '../document/registry.ts';

for (const collapsed of [false, true]) {
  test(`right boundary insertion preserves text when target is ${collapsed ? 'empty' : 'nonempty'}`, () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    try {
      registry.putText('source', 'ABCDEFGHIJ');
      registry.putText('left', 'ABCDE');
      registry.putText('right', 'FGHIJ');
      registry.registerSplitText('left', 'source', 0, 5);
      registry.registerSplitText('right', 'source', 5, 10);
      if (collapsed) registry.spliceText('right', 0, 5, '');
      registry.spliceText('right', 0, 0, 'XXX');
      expect(registry.projectedTextValue('left')).toBe('ABCDE');
      expect(registry.projectedTextValue('right')).toBe(collapsed ? 'XXX' : 'XXXFGHIJ');
      const cold = new Y.Doc();
      Y.applyUpdate(cold, Y.encodeStateAsUpdate(doc));
      const joined = new DocumentRegistry(cold);
      try {
        expect(joined.projectedTextValue('left')).toBe(registry.projectedTextValue('left'));
        expect(joined.projectedTextValue('right')).toBe(registry.projectedTextValue('right'));
      } finally {
        joined.destroy();
        cold.destroy();
      }
    } finally {
      registry.destroy();
      doc.destroy();
    }
  });
}
test('left boundary insertion stays left after deleting its following anchor character', () => {
  const doc = new Y.Doc();
  const registry = new DocumentRegistry(doc);
  try {
    registry.putText('source', 'ABCDEFGHIJ');
    registry.putText('left', 'ABCDE');
    registry.putText('right', 'FGHIJ');
    registry.registerSplitText('left', 'source', 0, 5);
    registry.registerSplitText('right', 'source', 5, 10);
    registry.spliceText('right', 0, 1, '');
    registry.spliceText('left', 5, 0, 'XXX');
    expect(registry.projectedTextValue('left')).toBe('ABCDEXXX');
    expect(registry.projectedTextValue('right')).toBe('GHIJ');
  } finally {
    registry.destroy();
    doc.destroy();
  }
});
test('an initially empty internal slice does not duplicate inserted text in its neighbors', () => {
  const doc = new Y.Doc();
  const registry = new DocumentRegistry(doc);
  try {
    registry.putText('source', 'ABCDEFGHIJ');
    for (const [id, start, end] of [
      ['left', 0, 5],
      ['middle', 5, 5],
      ['right', 5, 10],
    ] as const) {
      registry.putText(id, '');
      registry.registerSplitText(id, 'source', start, end);
    }
    registry.spliceText('middle', 0, 0, 'XXX');
    expect(['left', 'middle', 'right'].map((id) => registry.projectedTextValue(id))).toEqual([
      'ABCDE',
      'XXX',
      'FGHIJ',
    ]);
  } finally {
    registry.destroy();
    doc.destroy();
  }
});
