// Package-level fidelity comparators (document-engine 3.6): the exact uncompressed XML-part range
// comparator and the semantic ZIP-container comparator, tested against real DOCX round-trips.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import {
  compareXmlPartRanges,
  reassembleXmlPartRanges,
  compareZipContainers,
  parseDocx,
  writeDocx,
} from '../index.ts';

function readModel(bytes: Uint8Array) {
  const res = parseDocx(bytes);
  if (!res.ok) throw new Error(`parseDocx failed: ${JSON.stringify(res)}`);
  return res.model;
}

const enc = (s: string) => strToU8(s);

describe('exact uncompressed XML-part range comparator (3.6)', () => {
  const before = enc('<w:body><w:p>A</w:p><w:p>B</w:p><w:p>C</w:p></w:body>');

  test('reassembles a selective patch: unowned bytes verbatim, only owned ranges replaced', () => {
    // Patch the middle paragraph ("B") only.
    const start = strFromU8(before).indexOf('<w:p>B</w:p>');
    const end = start + '<w:p>B</w:p>'.length;
    const owned = [{ start, end, replacement: enc('<w:p>B-EDITED</w:p>') }];
    const after = reassembleXmlPartRanges(before, owned);
    expect(strFromU8(after)).toBe('<w:body><w:p>A</w:p><w:p>B-EDITED</w:p><w:p>C</w:p></w:body>');
    expect(compareXmlPartRanges(before, after, owned).equal).toBe(true);
  });

  test('flags an after that changed an UNOWNED byte (a paragraph outside the owned range)', () => {
    const start = strFromU8(before).indexOf('<w:p>B</w:p>');
    const owned = [{ start, end: start + '<w:p>B</w:p>'.length, replacement: enc('<w:p>B2</w:p>') }];
    // An after that ALSO tampered with paragraph C (unowned) must not match.
    const tampered = enc('<w:body><w:p>A</w:p><w:p>B2</w:p><w:p>C-TAMPERED</w:p></w:body>');
    const res = compareXmlPartRanges(before, tampered, owned);
    expect(res.equal).toBe(false);
    expect(strFromU8(res.expected!)).toBe('<w:body><w:p>A</w:p><w:p>B2</w:p><w:p>C</w:p></w:body>');
  });

  test('an empty owned set means after MUST equal before byte-for-byte', () => {
    expect(compareXmlPartRanges(before, before, []).equal).toBe(true);
    expect(compareXmlPartRanges(before, enc('<w:body><w:p>X</w:p></w:body>'), []).equal).toBe(false);
  });

  test('a length-changing replacement is honored (patch may grow or shrink the part)', () => {
    const owned = [{ start: 0, end: before.length, replacement: enc('<w:body/>') }];
    expect(strFromU8(reassembleXmlPartRanges(before, owned))).toBe('<w:body/>');
  });

  test('a non-integer (fractional / NaN) offset fails closed, never silently truncates', () => {
    // subarray() would truncate 0.9 -> 0 and mis-replace byte A; the guard must reject it.
    expect(() => reassembleXmlPartRanges(before, [{ start: 0.9, end: 1.9, replacement: enc('X') }])).toThrow(/non-integer/);
    expect(() => reassembleXmlPartRanges(before, [{ start: 0, end: Number.NaN, replacement: enc('X') }])).toThrow(/non-integer/);
  });

  test('an out-of-order / overlapping / out-of-bounds owned set fails closed', () => {
    expect(() => reassembleXmlPartRanges(before, [{ start: 10, end: 5, replacement: enc('') }])).toThrow(/out of order/);
    expect(() =>
      reassembleXmlPartRanges(before, [
        { start: 0, end: 20, replacement: enc('') },
        { start: 10, end: 30, replacement: enc('') }, // overlaps the first
      ]),
    ).toThrow(/out of order|overlapping/);
    expect(() => reassembleXmlPartRanges(before, [{ start: 0, end: before.length + 1, replacement: enc('') }])).toThrow(/out of bounds/);
  });
});

describe('semantic ZIP-container comparator (3.6)', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function docx(parts: Record<string, string>): Uint8Array {
    return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
  }
  const CT =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const base = {
    '[Content_Types].xml': CT,
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`,
    'word/styles.xml': `<w:styles xmlns:w="${W}"/>`,
    'customXml/item1.xml': '<b:root xmlns:b="urn:x"><b:v>keep</b:v></b:root>',
  };

  test('recompression alone is semantically equal (different archive bytes, same uncompressed parts)', () => {
    // Same parts, but zip with a different level → different compressed bytes/CRC framing.
    const a = zipSync(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, strToU8(v)])), { level: 0 });
    const b = zipSync(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, strToU8(v)])), { level: 9 });
    expect(a).not.toEqual(b); // the raw archives differ (recompression ephemera)
    const res = compareZipContainers(a, b);
    expect(res.equal).toBe(true);
    expect(res.changed).toEqual([]);
  });

  test('a changed unowned part is flagged; declaring it owned clears the flag', () => {
    const a = docx(base);
    const b = docx({ ...base, 'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults/></w:styles>` });
    const undeclared = compareZipContainers(a, b);
    expect(undeclared.equal).toBe(false);
    expect(undeclared.unownedChanged).toEqual(['/word/styles.xml']);
    const declared = compareZipContainers(a, b, { owned: ['/word/styles.xml'] });
    expect(declared.equal).toBe(true);
    expect(declared.changed).toEqual(['/word/styles.xml']);
  });

  test('added and removed unowned parts are flagged', () => {
    const a = docx(base);
    const withExtra = docx({ ...base, 'word/footer1.xml': `<w:ftr xmlns:w="${W}"/>` });
    expect(compareZipContainers(a, withExtra).unownedChanged).toEqual(['/word/footer1.xml']);
    const dropped = docx({
      '[Content_Types].xml': base['[Content_Types].xml'],
      'word/document.xml': base['word/document.xml'],
      'word/styles.xml': base['word/styles.xml'],
    });
    expect(compareZipContainers(a, dropped).unownedChanged).toEqual(['/customXml/item1.xml']);
  });

  test('a selective export that touches only /word/document.xml passes with it declared owned', () => {
    const original = docx(base);
    // A selective export edits the body part and re-emits every OTHER part verbatim.
    const entries = unzipSync(original);
    entries['word/document.xml'] = strToU8(strFromU8(entries['word/document.xml']).replace('hi', 'hello'));
    const edited = zipSync(entries);
    // Undeclared, the body change is flagged; declared owned, the export is clean and every other
    // part (styles, customXml, content-types) is proven byte-identical.
    expect(compareZipContainers(original, edited).unownedChanged).toEqual(['/word/document.xml']);
    const res = compareZipContainers(original, edited, { owned: ['/word/document.xml'] });
    expect(res.equal).toBe(true);
    expect(res.changed).toEqual(['/word/document.xml']);
  });

  test('a real writer round-trip of a PRESERVED package changes NO part at all (byte-identical)', () => {
    // A package opened with preservation re-emits EVERY part byte-for-byte on an unedited save (the
    // customXml part included). So the semantic ZIP comparison is fully equal with no owned set —
    // nothing moved, nothing dropped, nothing added.
    const original = docx(base);
    const parsed = parseDocx(original, { preserveAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const resaved = writeDocx(parsed.model);
    const res = compareZipContainers(original, resaved);
    expect(res.unownedChanged).toEqual([]);
    expect(res.equal).toBe(true);
  });

  test('OPC case-insensitive part names are the SAME part, not a false add/remove', () => {
    // `/Word/Document.xml` and `/word/document.xml` are OPC-equivalent; a case-only difference must
    // not be reported as one added + one removed part.
    const lower = zipSync({ 'word/document.xml': strToU8('<x/>'), '[Content_Types].xml': strToU8(CT) });
    const upper = zipSync({ 'Word/Document.xml': strToU8('<x/>'), '[Content_Types].xml': strToU8(CT) });
    const res = compareZipContainers(lower, upper);
    expect(res.added).toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.equal).toBe(true);
  });

  test('compression method is excluded from equality (stored vs deflated, within safe ratio)', () => {
    // Same uncompressed parts zipped at different deflate levels: the compressed framing differs but
    // the uncompressed maps are identical, so the comparator reports equal. The payload is varied
    // enough to stay under the safe default ratio cap (this is the common real-DOCX case).
    const body = Array.from({ length: 400 }, (_, i) => `<w:p><w:r><w:t>line ${i} of the document body</w:t></w:r></w:p>`).join('');
    const parts = { '[Content_Types].xml': CT, 'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>` };
    const stored = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), { level: 0 });
    const squeezed = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), { level: 9 });
    expect(stored).not.toEqual(squeezed); // different compressed framing
    const res = compareZipContainers(stored, squeezed);
    expect(res.readError).toBeUndefined();
    expect(res.equal).toBe(true);
  });

  test('a pathologically-compressible part is guarded by default, comparable via opt-in relaxed limits', () => {
    // A part that deflates FAR past the default 200:1 ratio: the safe default reader rejects it (so
    // an untrusted archive cannot be a memory-amplification vector), but a trusted caller can opt
    // into a relaxed maxRatio to compare its own known-safe output.
    const big = 'A'.repeat(300_000); // ~300 KB of one byte -> deflates past 1000:1
    const parts = { '[Content_Types].xml': CT, 'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${big}</w:t></w:r></w:p></w:body></w:document>` };
    const squeezed = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), { level: 9 });
    const stored = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])), { level: 0 });
    // Default: the pathological ratio is rejected, not silently compared.
    expect(compareZipContainers(stored, squeezed).readError).toContain('too-large');
    // Opt-in relaxed ratio (keeping the absolute size/entry caps): now they compare equal.
    const relaxed = compareZipContainers(stored, squeezed, {
      limits: { maxEntries: 10_000, maxTotalBytes: 512 * 1024 * 1024, maxRatio: Number.MAX_SAFE_INTEGER },
    });
    expect(relaxed.readError).toBeUndefined();
    expect(relaxed.equal).toBe(true);
  });

  test('a bounded-read rejection surfaces as readError, not a false match', () => {
    const a = docx(base);
    const notZip = strToU8('this is not a zip archive at all');
    const res = compareZipContainers(a, notZip);
    expect(res.equal).toBe(false);
    expect(res.readError).toContain('after');
  });
});
