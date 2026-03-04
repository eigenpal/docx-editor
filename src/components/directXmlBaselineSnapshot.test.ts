import { describe, expect, test } from 'bun:test';
import type { Document, Relationship } from '../types/document';
import {
  buildDirectXmlBaselineSnapshot,
  shouldHydrateBaselineFromSavedBytes,
} from './directXmlBaselineSnapshot';

function createRelationshipMap(entries: Array<[string, Relationship]>): Map<string, Relationship> {
  return new Map(entries);
}

function createDocument(options: { withRelationships?: boolean } = {}): Document {
  return {
    package: {
      document: {
        content: [],
      },
      relationships: options.withRelationships
        ? createRelationshipMap([
            [
              'rId1',
              {
                id: 'rId1',
                type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
                target: 'styles.xml',
              },
            ],
          ])
        : undefined,
    },
  };
}

describe('shouldHydrateBaselineFromSavedBytes', () => {
  test('returns false when relationships are already present', () => {
    expect(shouldHydrateBaselineFromSavedBytes(createDocument({ withRelationships: true }))).toBe(
      false
    );
  });

  test('returns true when relationships are missing', () => {
    expect(shouldHydrateBaselineFromSavedBytes(createDocument())).toBe(true);
    expect(shouldHydrateBaselineFromSavedBytes(null)).toBe(true);
  });
});

describe('buildDirectXmlBaselineSnapshot', () => {
  test('skips reparsing when relationships exist', async () => {
    let parserCalls = 0;
    const currentDocument = createDocument({ withRelationships: true });

    const result = await buildDirectXmlBaselineSnapshot({
      currentDocument,
      savedBuffer: new ArrayBuffer(8),
      parseSavedBuffer: async () => {
        parserCalls += 1;
        return createDocument({ withRelationships: true });
      },
    });

    expect(parserCalls).toBe(0);
    expect(result.hydratedFromSavedBytes).toBe(false);
    expect(result.hydrationError).toBeNull();
    expect(result.baselineDocument?.package.relationships?.size).toBe(1);
  });

  test('rehydrates from saved bytes when relationships are missing', async () => {
    let parserCalls = 0;
    const currentDocument = createDocument({ withRelationships: false });

    const result = await buildDirectXmlBaselineSnapshot({
      currentDocument,
      savedBuffer: new ArrayBuffer(8),
      parseSavedBuffer: async () => {
        parserCalls += 1;
        return createDocument({ withRelationships: true });
      },
    });

    expect(parserCalls).toBe(1);
    expect(result.hydratedFromSavedBytes).toBe(true);
    expect(result.hydrationError).toBeNull();
    expect(result.baselineDocument?.package.relationships?.size).toBe(1);
  });

  test('falls back to current document when reparse fails', async () => {
    const currentDocument = createDocument({ withRelationships: false });

    const result = await buildDirectXmlBaselineSnapshot({
      currentDocument,
      savedBuffer: new ArrayBuffer(8),
      parseSavedBuffer: async () => {
        throw new Error('parse failed');
      },
    });

    expect(result.hydratedFromSavedBytes).toBe(false);
    expect(result.hydrationError?.message).toContain('parse failed');
    expect(result.baselineDocument).not.toBeNull();
    expect(result.baselineDocument?.package.relationships).toBeUndefined();
  });
});
