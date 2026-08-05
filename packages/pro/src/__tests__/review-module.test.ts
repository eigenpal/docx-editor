// pro-licensing, v1 honor system: a module without a key is fully functional
// and silent, and NOTHING about licensing touches the network — pinned by
// spying on fetch for the whole construction + registration + use cycle.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core-contract/editor';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const TRACKED =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada" w:date="2024-01-01T00:00:00Z">` +
  `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('reviewModule without a key (honor system)', () => {
  test('fully functional, silent, and offline', () => {
    const fetchCalls: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error('licensing must never touch the network');
    }) as unknown as typeof fetch;
    const warnings: unknown[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const container = document.createElement('div');
      const editor = createDocxEditor({
        container,
        document: docx(TRACKED),
        author: 'Grace Hopper',
        modules: [reviewModule({})],
      });
      expect(editor.surface).not.toBeNull();
      expect(editor.getReviewItems().length).toBeGreaterThan(0);
      expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
      expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
      expect(warnings).toEqual([]);
      expect(fetchCalls).toEqual([]);
      editor.destroy();
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
    }
  });

  test('a key is accepted and equally silent', () => {
    const module = reviewModule({ licenseKey: 'DOCXPRO.not-verified-in-v1' });
    expect(module.id).toBe('review');
    expect(module.review).toBeDefined();
  });
});

describe('the free packages carry no review derivation', () => {
  test('core layout no longer exports the queue derivation', async () => {
    const layout = await import('@docx-editor.dev/core-contract/layout');
    // The vocabulary and pure helpers stay; the derivation is this package's.
    expect('reviewItemKey' in layout).toBe(true);
    expect('collectReviewItems' in layout).toBe(false);
    expect('revisionItemsOf' in layout).toBe(false);
    expect('commentAnchorsOfStory' in layout).toBe(false);
    expect('commentsOfPart' in layout).toBe(false);
  });
});
