import { describe, expect, test } from 'bun:test';
import type { RealDocChangeOperation } from '../docx/realDocumentChangeStrategy';
import type { Document } from '../types/document';
import {
  buildDirectXmlOperationsWithFallback,
  resolveDirectXmlSaveMode,
} from './DirectXmlDocxEditor';

describe('resolveDirectXmlSaveMode', () => {
  test('defaults to bestEffort when no explicit policy is provided', () => {
    expect(resolveDirectXmlSaveMode({})).toBe('bestEffort');
  });

  test('uses explicit directXmlSaveMode over legacy fallback flag', () => {
    expect(
      resolveDirectXmlSaveMode({
        directXmlSaveMode: 'strict',
        fallbackToModelSaveOnUnsupported: true,
      })
    ).toBe('strict');
  });

  test('maps legacy fallback flag to bestEffort when true', () => {
    expect(resolveDirectXmlSaveMode({ fallbackToModelSaveOnUnsupported: true })).toBe('bestEffort');
  });

  test('maps legacy fallback flag to strict when false', () => {
    expect(resolveDirectXmlSaveMode({ fallbackToModelSaveOnUnsupported: false })).toBe('strict');
  });
});

describe('buildDirectXmlOperationsWithFallback', () => {
  const context = {
    currentDocument: {} as Document,
    baselineDocument: {} as Document,
    editedParagraphIds: [],
  };

  test('returns operations when operation builder succeeds', async () => {
    const operations: RealDocChangeOperation[] = [
      {
        type: 'set-xml',
        path: 'word/document.xml',
        xml: '<w:document/>',
      },
    ];

    const result = await buildDirectXmlOperationsWithFallback({
      mode: 'bestEffort',
      context,
      buildDirectXmlOperations: async () => operations,
    });

    expect(result.operations).toEqual(operations);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
  });

  test('returns best-effort fallback details when operation builder throws', async () => {
    const result = await buildDirectXmlOperationsWithFallback({
      mode: 'bestEffort',
      context,
      buildDirectXmlOperations: async () => {
        throw new Error('planner-failed');
      },
    });

    expect(result.operations).toBeNull();
    expect(result.fallbackReason).toBe('operation-builder-error');
    expect(result.errorMessage).toContain('planner-failed');
  });

  test('throws in strict mode when operation builder throws', async () => {
    let thrown: unknown = null;
    try {
      await buildDirectXmlOperationsWithFallback({
        mode: 'strict',
        context,
        buildDirectXmlOperations: async () => {
          throw new Error('planner-failed');
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) return;
    expect(thrown.message).toContain('planner-failed');
  });
});
