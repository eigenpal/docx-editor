import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { withoutDocumentProperties } from '../package/document-property-removal.ts';

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = () =>
  zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="core" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Keep content</w:t></w:r></w:p></w:body></w:document>`
    ),
    'docProps/core.xml': strToU8(
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:lastModifiedBy>Reviewer</cp:lastModifiedBy></cp:coreProperties>'
    ),
    'unknown.xml': strToU8('<unknown xmlns="urn:retained">Preserve</unknown>'),
  });

test('property removal keeps the original package and unrelated parts for undo and reopen', () => {
  const parsed = readOoxmlPackage(fixture());
  if (!parsed.ok) throw new Error('Fixture failed to parse');
  const original = writeOoxmlPackage(parsed.package);
  const removed = withoutDocumentProperties(parsed.package);
  expect(removed).not.toBeNull();
  expect(writeOoxmlPackage(parsed.package)).toEqual(original);
  const before = unzipSync(original);
  const after = unzipSync(writeOoxmlPackage(removed!));
  expect(after['docProps/core.xml']).toBeUndefined();
  expect(after['word/document.xml']).toEqual(before['word/document.xml']);
  expect(after['unknown.xml']).toEqual(before['unknown.xml']);
  expect(strFromU8(after['_rels/.rels']!)).not.toContain('core-properties');
  const reopened = readOoxmlPackage(writeOoxmlPackage(removed!));
  if (!reopened.ok) throw new Error('Saved package failed to parse');
  expect(withoutDocumentProperties(reopened.package)).toBe(reopened.package);
});
