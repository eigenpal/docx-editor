/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `customNodeXml` — the server-side authoring path. The contract is recognition
// EQUIVALENCE: markup built here, spliced into a document by any external tool, is
// recognized exactly like a chip `insertCustomNode` authored in the editor.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { customNodeXml, defineCustomNode, recognizeCustomNodes } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });

function partWith(inline: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>see </w:t></w:r>${inline}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('customNodeXml', () => {
  test('builds markup the recognition pass accepts, locked by default', () => {
    const sdt = customNodeXml(
      citation,
      { sourceId: 'src_9f3', locator: 'p.42' },
      '(Smith 2024, p. 42)',
      { alias: 'Citation' }
    );
    expect(sdt.ok).toBe(true);
    if (!sdt.ok) return;
    expect(sdt.xml).toContain('w:lock w:val="contentLocked"');
    // Word Online drops id-less controls on resave; the builder writes one like Word does.
    expect(sdt.xml).toMatch(/<w:id w:val="\d+"\/>/);
    const [node] = recognizeCustomNodes(partWith(sdt.xml), [citation]);
    expect(node?.attrs).toEqual({ sourceId: 'src_9f3', locator: 'p.42' });
    expect(node?.text).toBe('(Smith 2024, p. 42)');
  });

  test('XML-hostile attrs and text come back intact, never as markup', () => {
    const hostile = '"&<x>\'';
    const sdt = customNodeXml(citation, { q: hostile }, `label ${hostile}`);
    expect(sdt.ok).toBe(true);
    if (!sdt.ok) return;
    expect(sdt.xml).not.toContain('<x>');
    const [node] = recognizeCustomNodes(partWith(sdt.xml), [citation]);
    expect(node?.attrs['q']).toBe(hostile);
    expect(node?.text).toBe(`label ${hostile}`);
  });

  test('refuses a tag past the Word cap, like insertCustomNode', () => {
    const sdt = customNodeXml(citation, { payload: 'x'.repeat(80) }, 'label');
    expect(sdt.ok).toBe(false);
    if (!sdt.ok) {
      expect(sdt.code).toBe('invalidArgs');
      expect(sdt.reason).toContain('64');
    }
  });

  test('XML-invalid control characters are stripped, not authored into a broken part', () => {
    const sdt = customNodeXml(citation, { q: 'v' }, 'la\u0000b\u0007el', { alias: 'A\u0001B' });
    expect(sdt.ok).toBe(true);
    if (!sdt.ok) return;
    const [node] = recognizeCustomNodes(partWith(sdt.xml), [citation]);
    expect(node?.text).toBe('label');
  });

  test('a definition that skipped defineCustomNode is refused on a hostile identity', () => {
    const raw = { name: 'x"]{}', tagPrefix: 'acme' } as unknown as typeof citation;
    const sdt = customNodeXml(raw, {}, 'label');
    expect(sdt.ok).toBe(false);
    if (!sdt.ok) expect(sdt.code).toBe('invalidArgs');
  });
});
