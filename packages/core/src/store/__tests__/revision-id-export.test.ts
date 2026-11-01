// Saved revision elements each carry their own `@w:id`, unique across all parts and within
// the 32-bit signed range. The live tree keeps the ids it holds, and a file whose ids are
// already unique saves unchanged.

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  writeOoxmlPackageKeepingRevisionIds,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { serializeOoxmlPart, type OoxmlNode } from '../package/ooxml-tree.ts';
import { parseRevisionId, uniqueRevisionIdsExportPackage } from '../package/revision-id-export.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const DATE = 'w:date="2026-01-01T00:00:00Z"';

/** A package with a body and, optionally, a header. */
function docx(body: string, header?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (header === undefined
          ? ''
          : `<Relationship Id="rId2" Type="${R}/header" Target="header1.xml"/>`) +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:mc="${MC}" xmlns:r="${R}" xmlns:w14="${W14}">` +
        `<w:body>${body}` +
        (header === undefined
          ? '<w:sectPr/>'
          : '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/></w:sectPr>') +
        '</w:body></w:document>'
    ),
    ...(header === undefined
      ? {}
      : { 'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`) }),
  });
}

function open(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

/** `localName:id` for every WML element with a `w:id`, in document order. */
function ids(pkg: OoxmlPackage, partName = pkg.mainDocumentPart): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    const id = node.attributes.find(
      (attribute) => attribute.namespaceUri === W && attribute.localName === 'id'
    )?.value;
    if (id !== undefined && node.namespaceUri === W) found.push(`${node.localName}:${id}`);
    for (const child of node.children) visit(child);
  };
  visit(pkg.parts.get(partName)!.root);
  return found;
}

function firstParagraphId(node: OoxmlNode): string {
  if (node.kind === 'paragraph') return node.id;
  if (node.kind !== 'textValue') {
    for (const child of node.children) {
      const found = child.kind === 'textValue' ? '' : firstParagraphId(child);
      if (found) return found;
    }
  }
  return '';
}

const saved = (pkg: OoxmlPackage): OoxmlPackage => open(writeOoxmlPackage(pkg));

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: string, text: string, author = 'Other') =>
  `<w:ins w:id="${id}" w:author="${author}" ${DATE}>${run(text)}</w:ins>`;
const del = (id: string, text: string) =>
  `<w:del w:id="${id}" w:author="Other" ${DATE}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;

describe('saved revision ids', () => {
  test('typing inside another author’s insertion saves three distinct ids', () => {
    const pkg = open(docx(`<w:p>${run('Hello ')}${ins('1', 'world')}</w:p>`));
    const store = new TreePackageStore(pkg, pkg.parts.get(pkg.mainDocumentPart)!);
    const paragraphId = firstParagraphId(store.bodyStore().part.root);
    const result = store.transact({ kind: 'body' }, (ctx) => {
      expect(
        ctx.apply({
          op: 'insertText',
          paragraphId,
          offset: 8,
          text: 'ide ',
          revision: { author: 'Me', date: '2026-02-01T00:00:00Z' },
        })
      ).toBe(true);
    });
    expect(result.ok).toBe(true);
    const live = store.currentPackage();
    // The split halves keep the one id the editor reviews them under.
    expect(ids(live)).toEqual(['ins:1', 'ins:2', 'ins:1']);

    const reopened = saved(live);
    expect(ids(reopened)).toEqual(['ins:1', 'ins:2', 'ins:3']);
    // Save is a projection: the live tree still holds the ids it had.
    expect(ids(store.currentPackage())).toEqual(['ins:1', 'ins:2', 'ins:1']);
    expect(store.currentPackage()).toBe(live);
  });

  test('a header revision and a body revision with one id get distinct ids', () => {
    const pkg = open(
      docx(`<w:p>${ins('4', 'body')}</w:p>`, `<w:p>${del('4', 'head')}${ins('5', 'more')}</w:p>`)
    );
    const reopened = saved(pkg);
    expect(ids(reopened)).toEqual(['ins:4']);
    expect(ids(reopened, '/word/header1.xml')).toEqual(['del:6', 'ins:5']);
  });

  test('ids outside the 32-bit range are replaced with in-range ids', () => {
    const pkg = open(
      docx(`<w:p>${ins('4294967299', 'a')}${ins('99999999999', 'b')}${ins('7', 'c')}</w:p>`)
    );
    expect(ids(saved(pkg))).toEqual(['ins:8', 'ins:9', 'ins:7']);
  });

  test('ids at the ceiling wrap to the lowest free id', () => {
    const pkg = open(
      docx(`<w:p>${ins('2147483647', 'a')}${ins('0', 'b')}${ins('0', 'c')}${ins('x', 'd')}</w:p>`)
    );
    expect(ids(saved(pkg))).toEqual(['ins:2147483647', 'ins:0', 'ins:1', 'ins:2']);
  });

  test('property and structural revisions share the one id space', () => {
    const body =
      '<w:p><w:pPr><w:pPrChange w:id="3" w:author="Other"><w:pPr/></w:pPrChange></w:pPr>' +
      '<w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Other"><w:rPr/></w:rPrChange></w:rPr>' +
      '<w:t>x</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:ins w:id="3" w:author="Other"/></w:trPr>' +
      '<w:tc><w:tcPr><w:cellIns w:id="3" w:author="Other"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>';
    expect(ids(saved(open(docx(body))))).toEqual([
      'pPrChange:3',
      'rPrChange:4',
      'ins:5',
      'cellIns:6',
    ]);
  });

  test('move ranges keep their start and end paired', () => {
    const body =
      `<w:p>${ins('5', 'kept')}` +
      '<w:moveFromRangeStart w:id="5" w:author="Other" w:name="m1"/>' +
      `<w:moveFrom w:id="6" w:author="Other" ${DATE}>${run('moved')}</w:moveFrom>` +
      '<w:moveFromRangeEnd w:id="5"/></w:p>' +
      '<w:p><w:moveToRangeStart w:id="5" w:author="Other" w:name="m1"/>' +
      `<w:moveTo w:id="6" w:author="Other" ${DATE}>${run('moved')}</w:moveTo>` +
      '<w:moveToRangeEnd w:id="5"/></w:p>';
    expect(ids(saved(open(docx(body))))).toEqual([
      'ins:5',
      'moveFromRangeStart:7',
      'moveFrom:6',
      'moveFromRangeEnd:7',
      'moveToRangeStart:8',
      'moveTo:9',
      'moveToRangeEnd:8',
    ]);
  });

  test('bookmarks and comments with colliding numbers are untouched', () => {
    const body =
      '<w:p><w:bookmarkStart w:id="1" w:name="b"/><w:commentRangeStart w:id="1"/>' +
      `${ins('1', 'a')}${del('1', 'b')}<w:bookmarkEnd w:id="1"/><w:commentRangeEnd w:id="1"/>` +
      '<w:r><w:commentReference w:id="1"/></w:r></w:p>';
    expect(ids(saved(open(docx(body))))).toEqual([
      'bookmarkStart:1',
      'commentRangeStart:1',
      'ins:1',
      'del:2',
      'bookmarkEnd:1',
      'commentRangeEnd:1',
      'commentReference:1',
    ]);
  });

  test('a fallback copy of its choice is not a second user of the ids', () => {
    const body =
      '<w:p><mc:AlternateContent><mc:Choice Requires="w14">' +
      `${ins('1', 'a')}</mc:Choice><mc:Fallback>${ins('1', 'a')}</mc:Fallback>` +
      '</mc:AlternateContent></w:p>';
    const pkg = open(docx(body));
    expect(uniqueRevisionIdsExportPackage(pkg)).toBe(pkg);
  });

  test('a document whose ids are unique saves byte-identical parts', () => {
    const pkg = open(
      docx(
        `<w:p>${ins('05', 'a')}${del('-3', 'b')}${ins('2', 'c')}</w:p>`,
        `<w:p>${ins('9', 'h')}</w:p>`
      )
    );
    expect(uniqueRevisionIdsExportPackage(pkg)).toBe(pkg);
    const bytes = writeOoxmlPackage(pkg);
    expect(bytes).toEqual(writeOoxmlPackageKeepingRevisionIds(pkg));
    const entries = unzipSync(bytes);
    for (const name of ['/word/document.xml', '/word/header1.xml']) {
      expect(new TextDecoder().decode(entries[name.slice(1)]!)).toBe(
        serializeOoxmlPart(pkg.parts.get(name)!)
      );
    }
  });

  test('keeping revision ids writes them as the package holds them', () => {
    const pkg = open(docx(`<w:p>${ins('1', 'a')}${ins('1', 'b')}</w:p>`));
    expect(ids(open(writeOoxmlPackageKeepingRevisionIds(pkg)))).toEqual(['ins:1', 'ins:1']);
    expect(ids(saved(pkg))).toEqual(['ins:1', 'ins:2']);
  });

  test('custom XML revision ranges keep their start and end paired', () => {
    const body =
      `<w:p>${ins('2', 'a')}<w:customXmlInsRangeStart w:id="2" w:author="Other"/>` +
      `${run('b')}<w:customXmlInsRangeEnd w:id="2"/>` +
      '<w:customXmlDelRangeStart w:id="2" w:author="Other"/>' +
      `${run('c')}<w:customXmlDelRangeEnd w:id="2"/></w:p>`;
    expect(ids(saved(open(docx(body))))).toEqual([
      'ins:2',
      'customXmlInsRangeStart:3',
      'customXmlInsRangeEnd:3',
      'customXmlDelRangeStart:4',
      'customXmlDelRangeEnd:4',
    ]);
  });

  test('a repeated save hands back the same renumbered copy', () => {
    const pkg = open(docx(`<w:p>${ins('1', 'a')}${ins('1', 'b')}</w:p><w:p>${run('plain')}</w:p>`));
    const first = uniqueRevisionIdsExportPackage(pkg);
    const second = uniqueRevisionIdsExportPackage(pkg);
    expect(first).not.toBe(pkg);
    const root = (value: OoxmlPackage) => value.parts.get(value.mainDocumentPart)!.root;
    // The same copy, so the serializer reuses the markup it cached for it.
    expect(root(second)).toBe(root(first));
  });
});

describe('parseRevisionId', () => {
  test('reads 32-bit signed integers and nothing else', () => {
    expect(parseRevisionId('0')).toBe(0);
    expect(parseRevisionId('-0')).toBe(0);
    expect(parseRevisionId('007')).toBe(7);
    expect(parseRevisionId('2147483647')).toBe(2147483647);
    expect(parseRevisionId('-2147483648')).toBe(-2147483648);
    for (const value of [
      '',
      '-',
      '+1',
      ' 1',
      '1 ',
      '1e3',
      '2147483648',
      '-2147483649',
      '4294967299',
      '99999999999',
      '00000000001',
      '١',
    ]) {
      expect(parseRevisionId(value)).toBeNull();
    }
  });
});
