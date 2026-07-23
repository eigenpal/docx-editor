// Preservation state: part-text + per-block source ranges for lossless re-emit
// (fidelity slice 1). Snapshot-safe and validated on decode (no duplicate/orphan
// keys). This settles the shape BEFORE the parser populates it.

import { describe, expect, test } from 'bun:test';
import { createEmptyModel, encodeModel, decodeModel, type PackageModel, type SerializedModel } from '../src/index.ts';

const PART = '/word/document.xml';

function withPreservation(): PackageModel {
  return {
    ...createEmptyModel(),
    preservation: {
      originalParts: new Map([[PART, '<w:document><w:body><w:tbl/></w:body></w:document>']]),
      blockRanges: new Map([['t1', { partName: PART, start: 19, end: 28, baselineHash: 'h-abc' }]]),
    },
  };
}

describe('preservation encode/decode', () => {
  test('originalParts and blockRanges survive a snapshot round-trip', () => {
    const decoded = decodeModel(encodeModel(withPreservation()));
    expect(decoded.preservation!.originalParts.get(PART)).toBe('<w:document><w:body><w:tbl/></w:body></w:document>');
    expect(decoded.preservation!.blockRanges.get('t1')).toEqual({ partName: PART, start: 19, end: 28, baselineHash: 'h-abc' });
  });

  test('a model with no preservation encodes/decodes to undefined (omitted when empty)', () => {
    const encoded = encodeModel(createEmptyModel());
    expect('preservation' in encoded).toBe(false);
    expect(decodeModel(encoded).preservation).toBeUndefined();
  });
});

describe('preservation decode validation', () => {
  test('a block range referencing an unretained part is rejected (orphan)', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [], blockRanges: [['t1', { partName: '/nope.xml', start: 0, end: 1, baselineHash: 'x' }]] },
    };
    expect(() => decodeModel(bad)).toThrow(/unknown part/);
  });

  test('duplicate part keys are rejected (silent overwrite would lose data)', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [[PART, 'a'], [PART, 'b']], blockRanges: [] },
    };
    expect(() => decodeModel(bad)).toThrow(/duplicate/);
  });

  test('duplicate block-range keys are rejected', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: {
        originalParts: [[PART, 'x']],
        blockRanges: [
          ['t1', { partName: PART, start: 0, end: 1, baselineHash: 'a' }],
          ['t1', { partName: PART, start: 2, end: 3, baselineHash: 'b' }],
        ],
      },
    };
    expect(() => decodeModel(bad)).toThrow(/duplicate/);
  });
});
