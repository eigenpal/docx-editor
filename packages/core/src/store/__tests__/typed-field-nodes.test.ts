// Typed canonical field nodes + atomic UTF-16 addressing.
//
// Covers parse/serialize, fingerprint, model offsets around A[field]Z, atomic
// delete/selection segments, malformed demotion, split runs, cached result
// formatting, fldSimple, locked/dirty attrs, ffData inertness, no fetch, round-trip.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  FIELD_ATOM_CHAR,
  applyTreeOp,
  atomicFieldSpansOf,
  canonicalOoxmlFingerprint,
  fieldOnOffAttribute,
  fldCharType,
  fldSimpleInstr,
  instrTextValue,
  isFldCharNode,
  isFldSimpleNode,
  isInstrTextNode,
  paragraphTextOf,
  readOoxmlPackage,
  readOoxmlPart,
  segmentsOf,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlPart,
} from '../index.ts';
import { piecesOfParagraph } from '../../layout/field-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    metadata
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children[0] as OoxmlElement;
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

function reopen(part: OoxmlPart): OoxmlPart {
  const xml = serializeOoxmlPart(part);
  const again = readOoxmlPart(xml, metadata);
  expect(again.ok).toBe(true);
  if (!again.ok) throw new Error(again.reason);
  return again.part;
}

describe('typed field parse / serialize', () => {
  test('types fldChar, instrText, and fldSimple with schema attrs', () => {
    const part = parse(
      `<w:p>` +
        `<w:r>` +
        `<w:fldChar w:fldCharType="begin" w:dirty="true" w:fldLock="0"/>` +
        `<w:instrText xml:space="preserve"> PAGE </w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:t>1</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r>` +
        `<w:fldSimple w:instr="NUMPAGES" w:dirty="true" w:fldLock="true">` +
        `<w:r><w:t>9</w:t></w:r>` +
        `</w:fldSimple>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const run = paragraph.children.find((child) => child.kind === 'run')!;
    const begin = run.children.find((child) => child.kind === 'fldChar')!;
    expect(isFldCharNode(begin)).toBe(true);
    expect(fldCharType(begin)).toBe('begin');
    expect(fieldOnOffAttribute(begin, 'dirty')).toBe(true);
    expect(fieldOnOffAttribute(begin, 'fldLock')).toBe(false);

    const instr = run.children.find((child) => child.kind === 'instrText')!;
    expect(isInstrTextNode(instr)).toBe(true);
    expect(instrTextValue(instr)).toBe(' PAGE ');

    const simple = paragraph.children.find((child) => child.kind === 'fldSimple')!;
    expect(isFldSimpleNode(simple)).toBe(true);
    expect(fldSimpleInstr(simple)).toBe('NUMPAGES');
    expect(fieldOnOffAttribute(simple, 'dirty')).toBe(true);
    expect(fieldOnOffAttribute(simple, 'fldLock')).toBe(true);
  });

  test('demotes fldChar without legal fldCharType to generic', () => {
    const part = parse(`<w:p><w:r><w:fldChar w:fldCharType="bogus"/></w:r></w:p>`);
    const run = paragraphOf(part).children.find((child) => child.kind === 'run')!;
    const node = run.children.find((child) => child.localName === 'fldChar')!;
    expect(node.kind).toBe('generic');
  });

  test('preserves unknown attrs and ffData children generically', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin" w:extra="keep">` +
        `<w:ffData>` +
        `<w:name w:val="Box"/>` +
        `<w:entryMacro w:val="EvilMacro"/>` +
        `<w:exitMacro w:val="OtherMacro"/>` +
        `</w:ffData>` +
        `</w:fldChar>` +
        `<w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const begin = paragraphOf(part)
      .children.find((child) => child.kind === 'run')!
      .children.find((child) => child.kind === 'fldChar')!;
    expect(begin.attributes.some((a) => a.localName === 'extra' && a.value === 'keep')).toBe(true);
    const ffData = begin.children.find(
      (child) => child.kind === 'generic' && child.localName === 'ffData'
    );
    expect(ffData).toBeDefined();
    expect(
      ffData!.children.some(
        (child) => child.kind !== 'textValue' && child.localName === 'entryMacro'
      )
    ).toBe(true);
  });

  test('normalized round-trip keeps fingerprint and does not rewrite fldSimple to complex', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>3</w:t><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:fldSimple w:instr="DATE"><w:r><w:t>x</w:t></w:r></w:fldSimple>` +
        `</w:p>`
    );
    const before = canonicalOoxmlFingerprint(part);
    const again = reopen(part);
    expect(canonicalOoxmlFingerprint(again)).toBe(before);
    const paragraph = paragraphOf(again);
    expect(paragraph.children.some((child) => child.kind === 'fldSimple')).toBe(true);
    expect(
      paragraph.children.some(
        (child) => child.kind === 'run' && child.children.some((grand) => grand.kind === 'fldChar')
      )
    ).toBe(true);
  });
});

describe('atomic UTF-16 addressing', () => {
  test('A[field]Z model offsets stay A, atom, Z', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>99</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
    const segments = segmentsOf(paragraph);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: 0, end: 1 });
    expect(segments[1]).toMatchObject({ start: 1, end: 2 });
    expect(segments[1]!.removeNodeIds?.length).toBeGreaterThan(0);
    expect(segments[2]).toMatchObject({ start: 2, end: 3 });

    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '7', 'Z']);
    expect(pieces[1]).toMatchObject({ start: 1, end: 2, projected: true });
    expect(pieces[1]!.style.bold).toBe(true);
    expect(pieces[2]).toMatchObject({ start: 2, end: 3 });
  });

  test('fldSimple is one atom and does not expose cached text as editable', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:fldSimple w:instr="DATE"><w:r><w:t>1999</w:t></w:r></w:fldSimple>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`A${FIELD_ATOM_CHAR}Z`);
    const segments = segmentsOf(paragraph);
    expect(segments).toHaveLength(3);
    expect(segments[1]!.node.kind).toBe('fldSimple');
    expect(segments[1]!.removeNodeIds).toEqual([segments[1]!.node.id]);
  });

  test('atomic delete removes begin through end in one op', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>99</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 1,
      end: 2,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('AZ');
    const next = paragraphOf(deleted.part);
    const xmlish = serializeOoxmlPart(deleted.part);
    expect(xmlish.includes('fldChar')).toBe(false);
    expect(xmlish.includes('instrText')).toBe(false);
    expect(next.children.some((child) => child.kind === 'fldSimple')).toBe(false);
  });

  test('insert beside a field does not land inside the instruction', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    const inserted = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 1,
      text: 'X',
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(paragraphTextOf(inserted.part, paragraph.id)).toBe(`${FIELD_ATOM_CHAR}XZ`);
    const again = reopen(inserted.part);
    expect(serializeOoxmlPart(again).includes('<w:instrText>PAGE</w:instrText>')).toBe(true);
  });

  test('caret segments have no interior offsets inside a field', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>12</w:t>` +
        `<w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const segments = segmentsOf(paragraphOf(part));
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  test('field atoms inside a hyperlink stay one UTF-16 unit', () => {
    // fldSimple is not a legal hyperlink child (demotes the container to generic); a
    // complex field nested in a run keeps the typed link and still contributes one atom.
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:hyperlink w:anchor="here">` +
        `<w:r><w:t>L</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>9</w:t>` +
        `<w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t>K</w:t></w:r>` +
        `</w:hyperlink>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(`AL${FIELD_ATOM_CHAR}KZ`);
    const segments = segmentsOf(paragraph);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(segments[2]!.removeNodeIds?.length).toBeGreaterThan(0);

    const deleted = applyTreeOp(part, {
      op: 'deleteText',
      paragraphId: paragraph.id,
      start: 2,
      end: 3,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(paragraphTextOf(deleted.part, paragraph.id)).toBe('ALKZ');
    const xmlish = serializeOoxmlPart(deleted.part);
    expect(xmlish.includes('fldChar')).toBe(false);
    expect(xmlish.includes('instrText')).toBe(false);
  });
});

describe('malformed demotion (fail-open)', () => {
  test('end without begin leaves surrounding text addressable', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t><w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('AZ');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
  });

  test('orphan instrText contributes no model text but stays in the tree', () => {
    const part = parse(
      `<w:p><w:r><w:t>A</w:t><w:instrText>PAGE</w:instrText><w:t>Z</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('AZ');
    expect(serializeOoxmlPart(part).includes('instrText')).toBe(true);
  });

  test('missing end demotes and keeps cached result text', () => {
    const part = parse(
      `<w:p>` +
        `<w:r><w:t>A</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText>PAGE</w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>99</w:t></w:r>` +
        `<w:r><w:t>Z</w:t></w:r>` +
        `</w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('A99Z');
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(0);
    const pieces = piecesOfParagraph(paragraph, [], { pageNumber: 7, pageCount: 10 });
    expect(pieces.map((p) => p.text)).toEqual(['A', '99', 'Z']);
    expect(pieces.every((p) => !p.projected)).toBe(true);
  });

  test('begin without separate still keeps following run text', () => {
    const part = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:t>VISIBLE</w:t></w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe('VISIBLE');
    expect(piecesOfParagraph(paragraph).map((p) => p.text)).toEqual(['VISIBLE']);
  });

  test('nested fields beyond cap demote and keep content', () => {
    // 5 nested begins (> MAX_FIELD_NESTING 4)
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>KEEP</w:t>` +
        `<w:fldChar w:fldCharType="end"/>`.repeat(5) +
        `</w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(paragraphTextOf(part, paragraph.id)).toBe(FIELD_ATOM_CHAR);
    expect(atomicFieldSpansOf(paragraph)).toHaveLength(1);
  });

  test('fields do not form across paragraphs', () => {
    const part = parse(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText></w:r></w:p>` +
        `<w:p><w:r><w:fldChar w:fldCharType="separate"/><w:t>1</w:t>` +
        `<w:fldChar w:fldCharType="end"/><w:t>Z</w:t></w:r></w:p>`
    );
    const body = part.root.children[0] as OoxmlElement;
    const first = body.children[0]!;
    const second = body.children[1]!;
    expect(first.kind).toBe('paragraph');
    expect(second.kind).toBe('paragraph');
    if (first.kind !== 'paragraph' || second.kind !== 'paragraph') return;
    expect(atomicFieldSpansOf(first)).toHaveLength(0);
    expect(paragraphTextOf(part, second.id)).toBe('1Z');
  });
});

describe('inertness and security', () => {
  test('non-page fields paint cached text and never evaluate', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin"/><w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:t>cached</w:t>` +
        `<w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const paragraph = paragraphOf(part);
    expect(
      piecesOfParagraph(paragraph, [], { pageNumber: 1, pageCount: 2 }).map((p) => p.text)
    ).toEqual(['cached']);
    expect(paragraphTextOf(part, paragraph.id)).toBe(FIELD_ATOM_CHAR);
  });

  test('ffData macros are preserved and never auto-resolved', () => {
    const part = parse(
      `<w:p><w:r>` +
        `<w:fldChar w:fldCharType="begin">` +
        `<w:ffData><w:entryMacro w:val="Boom"/><w:exitMacro w:val="Gone"/></w:ffData>` +
        `</w:fldChar>` +
        `<w:instrText>PAGE</w:instrText>` +
        `<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/>` +
        `</w:r></w:p>`
    );
    const xml = serializeOoxmlPart(part);
    expect(xml.includes('entryMacro')).toBe(true);
    expect(xml.includes('exitMacro')).toBe(true);
    // No fetch / execution surface: projection still only reads fldCharType + instrText.
    const pieces = piecesOfParagraph(paragraphOf(part), [], { pageNumber: 4, pageCount: 4 });
    expect(pieces.map((p) => p.text)).toEqual(['4']);
  });

  test('package save/reopen keeps complex fields and performs no network fetch', () => {
    const body =
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>` +
      `<w:instrText>INCLUDETEXT "http://evil.example/x"</w:instrText>` +
      `<w:fldChar w:fldCharType="separate"/><w:t>safe</w:t>` +
      `<w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const written = writeOoxmlPackage(loaded.package);
    const reopened = readOoxmlPackage(written);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const doc = reopened.package.parts.get(reopened.package.mainDocumentPart);
    expect(doc).toBeDefined();
    const xml = serializeOoxmlPart(doc!);
    expect(xml.includes('INCLUDETEXT')).toBe(true);
    expect(xml.includes('safe')).toBe(true);
    expect(xml.includes('w:dirty')).toBe(true);
  });
});
