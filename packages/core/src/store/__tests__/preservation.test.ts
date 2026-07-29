// Preservation state: part-text + per-block source ranges for lossless re-emit
// (fidelity slice 1). Snapshot-safe and validated on decode (no duplicate/orphan
// keys). This settles the shape BEFORE the parser populates it.

import { describe, expect, test } from 'bun:test';
import { createEmptyModel, encodeModel, decodeModel, diagnoseBodyPatchability, type PackageModel, type SerializedModel } from '../index.ts';

const PART = '/word/document.xml';
const TEXT = '<w:document><w:body><w:p/></w:body></w:document>';
// A preserved document must also retain its package parts (finding 7).
const PKG: readonly (readonly [string, string])[] = [[PART, '00']];

/** A valid preservation: the range references a REAL top-level block (createEmptyModel
 *  seeds body block `p-1`) and stays in bounds, so it passes decode validation. */
function withPreservation(): PackageModel {
  const base = createEmptyModel();
  const blockId = base.stories.get([...base.stories.keys()][0])!.blocks[0].id;
  return {
    ...base,
    preservation: {
      originalParts: new Map([[PART, TEXT]]),
      blockRanges: new Map([[blockId, { partName: PART, start: 20, end: 26, baselineHash: 'h-abc' }]]),
      packageParts: new Map([[PART, new Uint8Array([0])]]),
    },
  };
}

describe('preservation encode/decode', () => {
  test('originalParts and blockRanges survive a snapshot round-trip', () => {
    const model = withPreservation();
    const blockId = [...model.preservation!.blockRanges.keys()][0];
    const decoded = decodeModel(encodeModel(model));
    expect(decoded.preservation!.originalParts.get(PART)).toBe(TEXT);
    expect(decoded.preservation!.blockRanges.get(blockId)).toEqual({ partName: PART, start: 20, end: 26, baselineHash: 'h-abc' });
  });

  test('decode rejects an out-of-bounds range', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [[PART, 'short']], blockRanges: [['p-1', { partName: PART, start: 0, end: 999, baselineHash: 'x' }]], packageParts: PKG },
    };
    expect(() => decodeModel(bad)).toThrow(/out-of-bounds/);
  });

  test('a model with no preservation encodes/decodes to undefined (omitted when empty)', () => {
    const encoded = encodeModel(createEmptyModel());
    expect('preservation' in encoded).toBe(false);
    expect(decodeModel(encoded).preservation).toBeUndefined();
  });

  test('export-safety metadata (provenance / lossyParse / docDefaults / relatedStoryHashes) survives a snapshot round-trip', () => {
    // A snapshot must not drop the guards, or a restored model could re-open the data-loss holes.
    const created = decodeModel(encodeModel(createEmptyModel()));
    expect(created.provenance).toBe('created'); // stays exportable from scratch

    const base = withPreservation();
    const guarded: PackageModel = {
      ...base,
      provenance: 'parsed',
      lossyParse: true,
      docDefaults: { runProps: { bold: true } },
      preservation: { ...base.preservation!, relatedStoryHashes: new Map([['st-hdr', 'hash-1']]) },
    };
    const decoded = decodeModel(encodeModel(guarded));
    expect(decoded.provenance).toBe('parsed');
    expect(decoded.lossyParse).toBe(true);
    expect(decoded.docDefaults?.runProps?.bold).toBe(true);
    expect(decoded.preservation!.relatedStoryHashes!.get('st-hdr')).toBe('hash-1');
  });
});

describe('preservation decode validation', () => {
  test('a block range referencing an unretained part is rejected (orphan)', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [], blockRanges: [['t1', { partName: '/nope.xml', start: 0, end: 1, baselineHash: 'x' }]], packageParts: PKG },
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

describe('preservation package integrity', () => {
  test('ranges without package parts are rejected (finding 7: no silent lossy export)', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [[PART, TEXT]], blockRanges: [['p-1', { partName: PART, start: 20, end: 26, baselineHash: 'h' }]] },
    };
    expect(() => decodeModel(bad)).toThrow(/no package parts/);
  });

  test('malformed package-part hex is rejected on decode (finding 6)', () => {
    const bad: SerializedModel = {
      ...encodeModel(createEmptyModel()),
      preservation: { originalParts: [[PART, TEXT]], blockRanges: [], packageParts: [[PART, 'zz']] },
    };
    expect(() => decodeModel(bad)).toThrow(/invalid hex/);
  });
});

describe('read-only diagnostics (comprehensive 4.9)', () => {
  test('a model with no preservation snapshot diagnoses no-preservation', () => {
    const res = diagnoseBodyPatchability(createEmptyModel());
    expect(res.editable).toBe(false);
    expect(res.diagnostic.code).toBe('no-preservation');
    expect(res.diagnostic.missingLane).toBe('preservation');
    expect(typeof res.diagnostic.story).toBe('string'); // names the story
  });
});
