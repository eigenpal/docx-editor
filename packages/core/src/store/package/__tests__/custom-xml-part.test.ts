// The data part this authors has to be the one Word already accepts. `sdt-custom-tag-word-roundtrip.docx`
// is Word for the web's own output for a document carrying one, so it is the reference: the
// same part names, the same two relationship types, the same content type, and properties
// carrying a `ds:itemID` in the shape `w:storeItemID` will have to quote back.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, writeOoxmlPackage } from '../ooxml-package.ts';
import { relationshipsOf, resolveContentTypeOf } from '../package-edit.ts';
import {
  CUSTOM_XML_PROPS_REL,
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  customXmlDataParts,
  datastoreItemIdFor,
  findCustomXmlDataPart,
  withCustomXmlDataPart,
} from '../custom-xml-part.ts';
import type { OoxmlPackage } from '../ooxml-package.ts';

const STORY = '/word/document.xml';
const NS = 'http://docx-editor.dev/ns';

function fixture(name: string): OoxmlPackage {
  const path = resolve(import.meta.dir, '../../../../../../e2e/fixtures', name);
  const read = readOoxmlPackage(new Uint8Array(readFileSync(path)));
  if (!read.ok) throw new Error(read.reason);
  return read.package;
}

describe('reading the stores a document already carries', () => {
  test("Word's own output is read back as one store, with its item id", () => {
    const parts = customXmlDataParts(fixture('sdt-custom-tag-word-roundtrip.docx'), STORY);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.partName).toBe('/customXml/item1.xml');
    expect(parts[0]?.propsPartName).toBe('/customXml/itemProps1.xml');
    expect(parts[0]?.namespaceUri).toBe(NS);
    // Braced and upper-case: `w:storeItemID` has to quote it back exactly.
    expect(parts[0]?.itemId).toMatch(/^\{[0-9A-F-]{36}\}$/);
  });

  test('a document with no store reads as none rather than failing', () => {
    expect(
      customXmlDataParts(fixture('comprehensive-word-element-test.docx'), STORY).filter(
        (p) => p.namespaceUri === NS
      )
    ).toEqual([]);
  });
});

describe('authoring a store', () => {
  test('it lands as the same wiring Word writes', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const { pkg: next, part } = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    if (!part) throw new Error('no part authored');

    expect(next.parts.has(part.partName)).toBe(true);
    expect(next.parts.has(part.propsPartName)).toBe(true);
    // itemN.xml rides the package's `xml` default; only the properties need an Override.
    expect(resolveContentTypeOf(next, part.propsPartName)).toBe(CUSTOM_XML_PROPS_TYPE);

    const fromStory = relationshipsOf(next, STORY).find((r) => r.type === CUSTOM_XML_REL);
    expect(fromStory?.rawTarget).toBe('../customXml/item1.xml');
    const toProps = relationshipsOf(next, part.partName).find(
      (r) => r.type === CUSTOM_XML_PROPS_REL
    );
    expect(toProps?.rawTarget).toBe('itemProps1.xml');

    // The whole point: it reads back as a store, so the write and the read agree.
    expect(findCustomXmlDataPart(next, STORY, NS)?.itemId).toBe(part.itemId);
  });

  test('a second call adds nothing — one namespace, one store', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const once = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    const twice = withCustomXmlDataPart(once.pkg, STORY, NS, 'docxEditor');
    expect(twice.pkg.parts.size).toBe(once.pkg.parts.size);
    expect(twice.part?.itemId).toBe(once.part?.itemId);
  });

  test('it does not overwrite a store the document already had', () => {
    // The Word fixture already holds item1; a second namespace has to become item2.
    const pkg = fixture('sdt-custom-tag-word-roundtrip.docx');
    const { pkg: next, part } = withCustomXmlDataPart(pkg, STORY, 'urn:other', 'other');
    expect(part?.partName).toBe('/customXml/item2.xml');
    expect(next.parts.get('/customXml/item1.xml')).toBe(pkg.parts.get('/customXml/item1.xml'));
  });

  test('the package it produces still writes', () => {
    const pkg = fixture('comprehensive-word-element-test.docx');
    const { pkg: next } = withCustomXmlDataPart(pkg, STORY, NS, 'docxEditor');
    const reopened = readOoxmlPackage(writeOoxmlPackage(next));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(findCustomXmlDataPart(reopened.package, STORY, NS)?.namespaceUri).toBe(NS);
  });
});

describe('the item id', () => {
  // Randomness here would make the same document save to different bytes each time.
  test('is a pure function of the seed', () => {
    expect(datastoreItemIdFor('a')).toBe(datastoreItemIdFor('a'));
    expect(datastoreItemIdFor('a')).not.toBe(datastoreItemIdFor('b'));
    expect(datastoreItemIdFor('a')).toMatch(
      /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/
    );
  });
});
