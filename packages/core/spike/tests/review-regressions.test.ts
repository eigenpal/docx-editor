import { describe, expect, test } from 'bun:test';
import {
  compareCounterCeilings,
  compareSemanticZip,
  compareXmlPartRange,
  loadBindingOracle,
  loadVocabularyOracle,
  loadYjsSchemaOracle,
} from '../src';

describe('review regressions', () => {
  test('Yjs text records wrap a Y.Text child in metadata Y.Map', () => {
    const texts = loadYjsSchemaOracle().root.keys.texts.record;
    expect(texts.containerType).toBe('Y.Map');
    expect(texts.fields.content.type).toBe('Y.Text');
  });

  test('mark endpoints are opaque relative envelopes', () => {
    const fields = loadYjsSchemaOracle().root.keys.marks.record.fields;
    expect(fields.start.type).toBe('RelativeEndpointEnvelope');
    expect(fields.end.type).toBe('RelativeEndpointEnvelope');
  });

  test('IME replacement and UTF-16 flag boundaries are exact', () => {
    const oracle = loadBindingOracle();
    expect(oracle.offsetUnit).toBe('UTF-16-code-unit');
    expect(oracle.ime.fixtures[1]?.commitExpectedText).toBe('aXef');
    expect(oracle.selection.graphemeFixtures[0]?.validBoundaries).toEqual([0, 1, 5, 6]);
  });

  test('only toggleMark is a schema-backed command', () => {
    const command = loadVocabularyOracle().$defs['DocxEditor.Command'];
    expect(command.oneOf).toEqual([{ $ref: '#/$defs/toggleMarkCommand' }]);
    expect(loadVocabularyOracle().$defs['DocxEditor.RunFormatting']).toEqual({
      type: 'object',
      properties: { bold: { type: 'boolean' }, italic: { type: 'boolean' } },
      additionalProperties: false,
    });
  });

  test('XML comparator accepts variable-length owned replacement only', () => {
    const before = new TextEncoder().encode('prefix-OLD-suffix');
    const after = new TextEncoder().encode('prefix-LONGER-suffix');
    const evidence = {
      capsuleBytes: new Uint8Array([1]),
      namespaceBindings: { w: 'urn:w' },
      ownerSlot: { storyId: 'body', blockId: 'block-para-003', childIndex: 1 },
      previousSiblingBytes: new Uint8Array([2]),
      nextSiblingBytes: new Uint8Array([3]),
    };
    expect(
      compareXmlPartRange(before, after, 7, 10, { before: evidence, after: evidence }).equal
    ).toBe(true);
    const bad = new TextEncoder().encode('Prefix-LONGER-suffix');
    expect(compareXmlPartRange(before, bad, 7, 10).equal).toBe(false);
  });

  test('semantic ZIP rejects unlisted metadata changes', () => {
    const before = new Map([
      [
        'word/document.xml',
        {
          meta: {
            path: 'word/document.xml',
            crc32: 1,
            compressedSize: 2,
            uncompressedSize: 2,
            offset: 1,
            lastModifiedIso: '2026-01-01T00:00:00Z',
          },
          bytes: new Uint8Array([1, 2]),
        },
      ],
    ]);
    const after = new Map([
      [
        'word/document.xml',
        {
          meta: {
            path: 'word/document.xml',
            crc32: 1,
            compressedSize: 2,
            uncompressedSize: 2,
            offset: 1,
            lastModifiedIso: '2026-01-02T00:00:00Z',
          },
          bytes: new Uint8Array([1, 2]),
        },
      ],
    ]);
    expect(compareSemanticZip(before, after, {}).equal).toBe(false);
  });

  test('counters reject missing and negative observations', () => {
    const ceilings = {
      measuredParagraphs: 4,
      projectedParagraphs: 4,
      paginatedPages: 2,
      fullDocumentScans: 0,
      fullDocumentRebuilds: 0,
      dependencyEdgeVisits: 128,
    };
    expect(
      compareCounterCeilings({ measuredParagraphs: -1 } as never, ceilings).withinCeilings
    ).toBe(false);
    expect(compareCounterCeilings({} as never, ceilings).withinCeilings).toBe(false);
  });
});
