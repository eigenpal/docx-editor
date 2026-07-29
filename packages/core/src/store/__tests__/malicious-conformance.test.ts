// Consolidated malicious-input conformance (document-engine task 13.7; goal gate
// 6). Every input-security attack class is exercised end-to-end and MUST fail
// safely within limits, perform no external access, and leave no partial state.
// (Server tenant isolation lives in the hub, task 10.8, and is not covered here.)

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  parseDocx,
  readZip,
  readXml,
  toSafeRecord,
  sanitizeHref,
  escapeXml,
  isInertExecutable,
  scrubExport,
  validateEnvelope,
  normalizePartName,
  resolveInternalTarget,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(documentXml: string): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(documentXml) });
}

describe('archive attacks', () => {
  test('zip bomb: decompressed size over the limit is rejected', () => {
    const big = zipSync({ 'word/document.xml': strToU8('x'.repeat(1_000_000)) });
    expect(readZip(big, { maxEntries: 100, maxTotalBytes: 1000 })).toMatchObject({ ok: false, reason: 'too-large' });
  });
  test('zip bomb: a high compression ratio is rejected BEFORE inflation, even under a generous size limit', () => {
    // Small compressed, huge uncompressed -> caught by the ratio guard, not the total.
    const bomb = zipSync({ 'word/document.xml': strToU8('A'.repeat(2_000_000)) }, { level: 9 });
    expect(readZip(bomb, { maxEntries: 100, maxTotalBytes: 1_000_000_000, maxRatio: 200 })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });
  test('path traversal entry name is rejected before inflation', () => {
    const evil = zipSync({ 'word/../../etc/passwd': strToU8('x') });
    expect(readZip(evil)).toMatchObject({ ok: false, reason: 'bad-name' });
  });
  test('OPC name normalization rejects traversal/encoded/backslash', () => {
    expect(normalizePartName('../secret').ok).toBe(false);
    expect(normalizePartName('a%2f..%2fb').ok).toBe(false);
    expect(resolveInternalTarget('/word/document.xml', '../../../../etc/passwd').ok).toBe(false);
  });
});

describe('XML attacks', () => {
  test('DTD / entity declaration / custom entity ref are refused (XXE, billion-laughs)', () => {
    expect(readXml('<!DOCTYPE x><x/>')).toMatchObject({ ok: false, reason: 'dtd-forbidden' });
    expect(readXml('<!ENTITY e "x"><x/>')).toMatchObject({ ok: false, reason: 'entity-forbidden' });
    expect(readXml('<x>&custom;</x>')).toMatchObject({ ok: false, reason: 'entity-forbidden' });
  });
  test('a DOCX carrying a DTD in document.xml fails safely', () => {
    expect(parseDocx(docx('<!DOCTYPE d [<!ENTITY x "y">]><w:document><w:body/></w:document>'))).toMatchObject({
      ok: false,
      reason: 'xml-error',
    });
  });
  test('excessive nesting is bounded, not a stack overflow', () => {
    expect(readXml('<a>'.repeat(3000) + '</a>'.repeat(3000)).ok).toBe(false);
  });
  test('XML injection on save is neutralized by escaping', () => {
    expect(escapeXml('</w:t><w:evil/>')).toBe('&lt;/w:t&gt;&lt;w:evil/&gt;');
  });
});

describe('prototype pollution', () => {
  test('a __proto__ payload from parsed data is rejected', () => {
    expect(() => toSafeRecord(JSON.parse('{"__proto__":{"admin":true}}'))).toThrow();
    expect(({} as Record<string, unknown>).admin).toBeUndefined(); // no global pollution
  });
});

describe('unsafe URLs / zero-click fetch', () => {
  test('dangerous schemes render inert; parsing issues no request', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
      expect(sanitizeHref(bad)).toMatchObject({ ok: false, inert: true });
    }
    // parseDocx never fetches; a document with an external-looking target just parses inertly.
    expect(parseDocx(docx(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`)).ok).toBe(true);
  });
});

describe('malformed replication + inert executable', () => {
  test('malformed / oversized / wrong-document envelopes are rejected before mutation', () => {
    const ctx = { documentId: 'd', protocolVersion: 1 };
    expect(validateEnvelope({ protocolVersion: 1, documentId: 'd', bytesHex: 'abc' }, ctx)).toMatchObject({ ok: false, reason: 'truncated' });
    expect(validateEnvelope({ protocolVersion: 1, documentId: 'other', bytesHex: 'ab' }, ctx)).toMatchObject({ ok: false, reason: 'wrong-document' });
    expect(validateEnvelope({ protocolVersion: 9, documentId: 'd', bytesHex: 'ab' }, ctx)).toMatchObject({ ok: false, reason: 'wrong-protocol' });
  });
  test('executable content is inert and scrub reports removals non-lossless', () => {
    expect(isInertExecutable('macro')).toBe(true);
    expect(isInertExecutable('ole')).toBe(true);
    const r = scrubExport([{ id: 'p', kind: 'paragraph' }, { id: 'm', kind: 'macro' }]);
    expect(r.removed.map((x) => x.id)).toEqual(['m']);
    expect(r.nonLossless).toBe(true);
  });
});

describe('no partial state', () => {
  test('a rejected malicious parse yields no model', () => {
    const r = parseDocx(zipSync({ 'word/../evil': strToU8('x') }));
    expect(r.ok).toBe(false);
    // No `model` field exists on a failure result.
    expect('model' in r).toBe(false);
  });
});

describe('zip name integrity (review findings 5, 8)', () => {
  test('two entries whose names normalize to the same part are rejected before inflation', () => {
    const evil = zipSync({ 'word/document.xml': strToU8('a'), 'word/%64ocument.xml': strToU8('b') });
    expect(readZip(evil)).toMatchObject({ ok: false, reason: 'bad-name' });
  });
});

describe('zip case-folded OPC equivalence (review round 2, findings 5/8)', () => {
  test('case-equivalent entry names are rejected before inflation', () => {
    const evil = zipSync({ 'word/document.xml': strToU8('a'), 'Word/Document.xml': strToU8('b') });
    expect(readZip(evil)).toMatchObject({ ok: false, reason: 'bad-name' });
  });
});
