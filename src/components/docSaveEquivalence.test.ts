import { describe, expect, test } from 'bun:test';
import type { Document, HeaderFooter } from '../types/document';
import {
  areDocumentsSaveEquivalent,
  cloneArrayBuffer,
  cloneDocumentForBaseline,
  createSaveEquivalenceSignature,
} from './docSaveEquivalence';

function createHeaderFooter(contentText: string): HeaderFooter {
  return {
    type: 'header',
    hdrFtrType: 'default',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'run',
            content: [{ type: 'text', text: contentText }],
          },
        ],
      },
    ],
  };
}

function createDocument(input: {
  body: unknown;
  headers?: Map<string, HeaderFooter>;
  footers?: Map<string, HeaderFooter>;
  footnotes?: unknown;
  endnotes?: unknown;
}): Document {
  return {
    package: {
      document: input.body as Document['package']['document'],
      headers: input.headers,
      footers: input.footers,
      footnotes: input.footnotes as Document['package']['footnotes'],
      endnotes: input.endnotes as Document['package']['endnotes'],
    },
    originalBuffer: new ArrayBuffer(8),
  };
}

describe('docSaveEquivalence', () => {
  test('treats structurally equal docs as equivalent', () => {
    const baseline = createDocument({
      body: { content: [{ type: 'paragraph', content: [] }] },
      headers: new Map([['rId1', createHeaderFooter('Same')]]),
    });

    const current = createDocument({
      body: { content: [{ type: 'paragraph', content: [] }] },
      headers: new Map([['rId1', createHeaderFooter('Same')]]),
    });

    expect(areDocumentsSaveEquivalent(current, baseline)).toBe(true);
  });

  test('detects body edits', () => {
    const baseline = createDocument({
      body: { content: [{ type: 'paragraph', content: [] }] },
    });

    const current = createDocument({
      body: { content: [{ type: 'paragraph', content: [{ type: 'run', content: 'changed' }] }] },
    });

    expect(areDocumentsSaveEquivalent(current, baseline)).toBe(false);
  });

  test('detects header/footer edits', () => {
    const baseline = createDocument({
      body: { content: [] },
      headers: new Map([['rId1', createHeaderFooter('Before')]]),
      footers: new Map([['rId2', createHeaderFooter('Before footer')]]),
    });

    const current = createDocument({
      body: { content: [] },
      headers: new Map([['rId1', createHeaderFooter('After')]]),
      footers: new Map([['rId2', createHeaderFooter('Before footer')]]),
    });

    expect(areDocumentsSaveEquivalent(current, baseline)).toBe(false);
  });

  test('cloneArrayBuffer creates an independent copy', () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    const cloned = cloneArrayBuffer(source);

    expect(cloned).not.toBe(source);
    expect(Array.from(new Uint8Array(cloned))).toEqual([1, 2, 3, 4]);
  });

  test('signature detects in-place mutations', () => {
    const doc = createDocument({
      body: { content: [{ type: 'paragraph', content: [] }] },
      headers: new Map([['rId1', createHeaderFooter('Before')]]),
    });

    const before = createSaveEquivalenceSignature(doc);

    // Simulate in-place mutation risk.
    const header = doc.package.headers?.get('rId1');
    if (header) {
      header.content = [
        {
          type: 'paragraph',
          content: [{ type: 'run', content: [{ type: 'text', text: 'After' }] }],
        },
      ];
    }

    const after = createSaveEquivalenceSignature(doc);
    expect(after).not.toBe(before);
  });

  test('cloneDocumentForBaseline creates independent snapshot with structuredClone', () => {
    if (typeof structuredClone !== 'function') {
      return;
    }

    const doc = createDocument({
      body: { content: [{ type: 'paragraph', content: [] }] },
      headers: new Map([['rId1', createHeaderFooter('Snapshot')]]),
    });

    const cloned = cloneDocumentForBaseline(doc);
    expect(cloned).not.toBe(doc);

    doc.package.headers?.set('rId2', createHeaderFooter('Later'));
    expect(cloned.package.headers?.has('rId2')).toBe(false);
  });
});
