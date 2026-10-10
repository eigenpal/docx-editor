/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { probe, snapshot, compareSnapshots } from './probe.ts';
import { readOoxmlPackage } from '../../../core/src/store/package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
function fixture(body: string) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/media/synthetic.bin': new Uint8Array([1, 2, 3]),
  });
}
const paragraph = '<w:p><w:r><w:t>Private synthetic text</w:t></w:r></w:p>';

describe('headless evaluation probe', () => {
  test('preserves the package, checks edit isolation, undo, and retained layout', () => {
    const result = probe(fixture(paragraph + paragraph));
    expect(result.status).toBe('passed');
    expect(
      result.checks.filter((check) => check.status === 'passed').map((check) => check.id)
    ).toEqual([
      'open',
      'preservation',
      'edit-isolation',
      'edit-save-reopen',
      'incremental-layout',
      'undo',
    ]);
    expect(result.scope.browserInput).toBe(false);
    expect(result.scope.productionFonts).toBe(false);
    expect(JSON.stringify(result)).not.toContain('Private synthetic text');
  });
  test('records missing edit coverage instead of passing an empty document', () => {
    const result = probe(fixture(''));
    expect(result.checks.find((check) => check.id === 'edit-isolation')?.status).toBe(
      'unsupported'
    );
    expect(result.checks.find((check) => check.id === 'incremental-layout')?.status).toBe(
      'unsupported'
    );
  });
  test('refuses invalid bytes', () => {
    const result = probe(new Uint8Array([1, 2, 3]));
    expect(result.status).toBe('unsupported');
    expect(result.checks.find((check) => check.id === 'open')?.status).toBe('unsupported');
  });
  test('detects removed binary parts, relationships, and text with bounded hashes', () => {
    const parsed = readOoxmlPackage(fixture(paragraph));
    if (!parsed.ok) throw new Error(parsed.reason);
    const before = snapshot(parsed.package);
    for (const key of [
      '/word/media/synthetic.bin:binary',
      '/:relationships',
      '/word/document.xml:semantic',
    ]) {
      expect(before.has(key)).toBe(true);
      const after = new Map(before);
      after.delete(key);
      const finding = compareSnapshots('preservation', before, after);
      expect(finding.status).toBe('failed');
      expect(finding.firstDivergence?.path).toBe(key);
      expect(finding.firstDivergence?.beforeHash?.length).toBe(64);
    }
  });
  test('runs a table paragraph through the same edit recipe', () => {
    const result = probe(
      fixture(
        `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`
      )
    );
    expect(result.status).toBe('passed');
    expect(result.checks.find((check) => check.id === 'edit-isolation')?.status).toBe('passed');
  });
});
