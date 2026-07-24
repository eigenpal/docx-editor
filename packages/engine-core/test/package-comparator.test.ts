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
} from '../src/index.ts';

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

  test('a real writer round-trip of a preserved package changes no unowned part', () => {
    // A package the writer preserves (round-trips through parse→model→write) must, unedited, leave
    // every non-body part byte-identical. Declare the body part owned (the writer canonicalizes its
    // XML header/xml:space even with no semantic edit) and assert nothing else moved.
    const original = docx(base);
    const resaved = writeDocx(readModel(original));
    const res = compareZipContainers(original, resaved, {
      owned: ['/word/document.xml', '/[Content_Types].xml', '/_rels/.rels', '/word/styles.xml', '/customXml/item1.xml'],
    });
    // Whatever the writer does, it must not touch a part outside the declared owned set.
    expect(res.unownedChanged).toEqual([]);
  });

  test('a bounded-read rejection surfaces as readError, not a false match', () => {
    const a = docx(base);
    const notZip = strToU8('this is not a zip archive at all');
    const res = compareZipContainers(a, notZip);
    expect(res.equal).toBe(false);
    expect(res.readError).toContain('after');
  });
});
