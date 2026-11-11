import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage, type OoxmlPackage } from '../ooxml-package.ts';
import { contentTypeExportPackage } from '../content-type-export.ts';

const NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const AUTHORED = `<Types xmlns="${NS}" xmlns:x="urn:extra">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="${MAIN}"/>
<Override PartName="/Orphan.XML" ContentType="application/xml" x:keep="yes"><x:child/></Override>
<Override PartName="/Orphan.XML" ContentType="application/xml"/>
<Override PartName="/invalid.xml" ContentType="invalid"/>
<Override PartName="/ignored.xml" ContentType="image/.jpg"/>
<Override PartName="/ignored.xml" ContentType="image/jpeg"/>
<x:Override PartName="/foreign.xml" ContentType="foreign"/>
<Override PartName="/missing.xml" x:ContentType="malformed"/>
</Types>`;

function open(): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(AUTHORED),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function types(pkg: OoxmlPackage): string {
  return strFromU8(unzipSync(writeOoxmlPackage(pkg))['[Content_Types].xml']!);
}

test('unchanged index preserves authored bytes, duplicate records, and ignored records', () => {
  const pkg = open();
  expect(contentTypeExportPackage(pkg)).toBe(pkg);
  expect(types(pkg)).toBe(AUTHORED);
});

test('new overrides preserve unrelated authored records and leave the input unchanged', () => {
  const pkg = open();
  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.set('/word/new.xml', 'application/example+xml');
  const next = { ...pkg, contentTypes: { ...pkg.contentTypes, overrides } };
  const xml = types(next);
  expect(xml).toContain('PartName="/word/new.xml"');
  expect(xml.match(/PartName="\/Orphan.XML"/g)).toHaveLength(2);
  for (const name of ['invalid', 'ignored', 'foreign', 'missing']) {
    expect(xml).toContain(`PartName="/${name}.xml"`);
  }
  expect(xml).toContain('keep="yes"');
  expect(xml).toContain('child');
  expect(types(pkg)).toBe(AUTHORED);
  expect(next.partBytes).toBe(pkg.partBytes);
});

test('changed and deleted overrides update the saved bytes without dropping ignored records', () => {
  const pkg = open();
  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.set('/orphan.xml', 'application/example+xml');
  overrides.delete('/ignored.xml');
  const next = { ...pkg, contentTypes: { ...pkg.contentTypes, overrides } };
  const xml = types(next);
  expect(xml).toContain('application/example+xml');
  expect(xml).not.toContain('PartName="/ignored.xml"');
  expect(xml).toContain('PartName="/invalid.xml"');
  expect(xml).toContain('keep="yes"');
  const reopened = readOoxmlPackage(writeOoxmlPackage(next));
  expect(reopened.ok).toBe(true);
  if (reopened.ok) expect(reopened.package.contentTypes).toEqual(next.contentTypes);
});
