// REF instruction recognition and story resolution (field-ref.ts).
//
// The instruction is attacker-controlled: everything outside the supported grammar must
// resolve to null so the field keeps its cached result. Resolution reads the bookmark target
// and the resolved list items; a missing bookmark or an unnumbered target under a number
// switch resolves to null the same way.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { parseRefInstruction, resolveStoryRefFields } from '../field-ref.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { MAX_FIELD_INSTRUCTION_CHARS } from '../field-instruction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('parseRefInstruction', () => {
  test('recognizes the bare form and each supported switch', () => {
    expect(parseRefInstruction(' REF _Ref137575642 ')).toEqual({
      bookmark: '_Ref137575642',
      numberSwitch: null,
      hyperlink: false,
    });
    expect(parseRefInstruction(' REF _Ref137575642 \\r \\h \\* MERGEFORMAT ')).toEqual({
      bookmark: '_Ref137575642',
      numberSwitch: 'r',
      hyperlink: true,
    });
    expect(parseRefInstruction('REF target \\w')?.numberSwitch).toBe('w');
    expect(parseRefInstruction('REF target \\n')?.numberSwitch).toBe('n');
    // The keyword matches case-insensitively; the bookmark name keeps its authored case.
    expect(parseRefInstruction('ref MixedCase \\R')).toEqual({
      bookmark: 'MixedCase',
      numberSwitch: 'r',
      hyperlink: false,
    });
    expect(parseRefInstruction('REF "quoted name" \\h')?.bookmark).toBe('quoted name');
  });

  test('anything outside the supported grammar stays inert (null)', () => {
    // Unknown switches fall back to the cached result — never a guess.
    expect(parseRefInstruction('REF target \\p')).toBeNull();
    expect(parseRefInstruction('REF target \\f')).toBeNull();
    expect(parseRefInstruction('REF target \\d "-"')).toBeNull();
    expect(parseRefInstruction('REF target \\# 0.00')).toBeNull();
    expect(parseRefInstruction('REF target \\* Upper')).toBeNull();
    // Missing or malformed bookmark argument.
    expect(parseRefInstruction('REF')).toBeNull();
    expect(parseRefInstruction('REF \\r')).toBeNull();
    expect(parseRefInstruction(`REF ${'x'.repeat(257)}`)).toBeNull();
    expect(parseRefInstruction('REF "unterminated')).toBeNull();
    // Other keywords are not this field.
    expect(parseRefInstruction('NOTEREF _Ref1 \\r')).toBeNull();
    expect(parseRefInstruction('PAGEREF _Ref1 \\h')).toBeNull();
    // Over the shared instruction cap fails closed.
    expect(parseRefInstruction(`REF ${'y'.repeat(MAX_FIELD_INSTRUCTION_CHARS)}`)).toBeNull();
  });

  test('a hostile bookmark name is only ever a Map key', () => {
    // `__proto__` parses as an ordinary name; resolution looks it up in a Map and finds
    // nothing, polluting nothing.
    expect(parseRefInstruction('REF __proto__ \\r')?.bookmark).toBe('__proto__');
  });
});

const NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function numberingIndex() {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function blocksOf(part: OoxmlPart): OoxmlElement[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  return body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
}

const numbered = (ilvl: number, inner: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="5"/></w:numPr></w:pPr>${inner}</w:p>`;
const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
const refField = (instr: string) =>
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>stale</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

function contextFor(part: OoxmlPart) {
  const blocks = blocksOf(part);
  const listItems = resolveStoryListItems(blocks, numberingIndex(), undefined);
  return resolveStoryRefFields(blocks, listItems);
}

describe('resolveStoryRefFields', () => {
  test('a story with no REF field resolves to null', () => {
    const part = document(numbered(0, bookmarked('_Ref1', 'Heading')) + '<w:p/>');
    expect(contextFor(part)).toBeNull();
  });

  test('number switches resolve the marker with the trailing period trimmed', () => {
    const part = document(
      numbered(0, bookmarked('top', 'One')) +
        numbered(1, bookmarked('sub', 'One point one')) +
        refField(' REF top \\r ') +
        refField(' REF sub \\w ')
    );
    const context = contextFor(part)!;
    // `1.` trims its bare trailing period; `1.1` keeps its interior one.
    expect(context.valueOf({ bookmark: 'top', numberSwitch: 'r', hyperlink: false })).toBe('1');
    expect(context.valueOf({ bookmark: 'sub', numberSwitch: 'w', hyperlink: false })).toBe('1.1');
    expect(context.valueOf({ bookmark: 'sub', numberSwitch: 'n', hyperlink: false })).toBe('1.1');
  });

  test('a plain REF extracts the bookmarked text, capped inside the target paragraph', () => {
    const part = document(
      `<w:p><w:r><w:t>lead </w:t></w:r>${bookmarked('term', 'Closing Date')}` +
        `<w:r><w:t> tail</w:t></w:r></w:p>` +
        refField(' REF term ')
    );
    const context = contextFor(part)!;
    expect(context.valueOf({ bookmark: 'term', numberSwitch: null, hyperlink: false })).toBe(
      'Closing Date'
    );
  });

  test('missing bookmark and unnumbered target resolve to null (cached fallback)', () => {
    const part = document(
      `<w:p>${bookmarked('plain', 'no number here')}</w:p>` + refField(' REF plain \\r ')
    );
    const context = contextFor(part)!;
    expect(
      context.valueOf({ bookmark: 'absent', numberSwitch: null, hyperlink: false })
    ).toBeNull();
    expect(context.valueOf({ bookmark: 'plain', numberSwitch: 'r', hyperlink: false })).toBeNull();
  });

  test('the first declaration of a duplicated name wins, in document order', () => {
    const part = document(
      numbered(0, bookmarked('dup', 'first')) +
        numbered(0, bookmarked('dup', 'second')) +
        refField(' REF dup \\r ')
    );
    const context = contextFor(part)!;
    expect(context.valueOf({ bookmark: 'dup', numberSwitch: 'r', hyperlink: false })).toBe('1');
  });

  test('paragraph tokens and the story token move with the resolved values', () => {
    const before = document(
      numbered(0, bookmarked('t', 'A')) +
        numbered(0, '<w:r><w:t>B</w:t></w:r>') +
        refField(' REF t \\r ')
    );
    // Same markup with one numbered paragraph inserted ahead: the target renumbers 1 → 2.
    const after = document(
      numbered(0, '<w:r><w:t>Z</w:t></w:r>') +
        numbered(0, bookmarked('t', 'A')) +
        numbered(0, '<w:r><w:t>B</w:t></w:r>') +
        refField(' REF t \\r ')
    );
    const beforeContext = contextFor(before)!;
    const afterContext = contextFor(after)!;
    expect(beforeContext.valuesToken).not.toBe(afterContext.valuesToken);
    const refParagraphBefore = blocksOf(before).at(-1)!;
    const refParagraphAfter = blocksOf(after).at(-1)!;
    expect(beforeContext.tokenForParagraph(refParagraphBefore.id)).not.toBe(
      afterContext.tokenForParagraph(refParagraphAfter.id)
    );
    // A paragraph with no REF field keys nothing.
    expect(beforeContext.tokenForParagraph(blocksOf(before)[0]!.id)).toBe('');
  });
});

/** The standard legal shape: deep levels state only their OWN placeholder. */
const LEGAL_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/>
      <w:lvlText w:val="(%4)"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function contextUnder(numberingXml: string, part: OoxmlPart) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${numberingXml}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const blocks = blocksOf(part);
  const listItems = resolveStoryListItems(blocks, buildNumberingIndex(result.part.root), undefined);
  return resolveStoryRefFields(blocks, listItems);
}

describe('number switches compose the FULL-CONTEXT number from the counter path', () => {
  // Counters at the deep targets: 1, 2, 3, 2 — the `(c)` marker alone is not the number a
  // reader cites; Word's cached result says `1.2(c)`, and the live value must match it.
  const body =
    numbered(0, bookmarked('art', 'Article one')) +
    numbered(1, '<w:r><w:t>1.1</w:t></w:r>') +
    numbered(1, bookmarked('sec', 'Section 1.2')) +
    numbered(2, '<w:r><w:t>(a)</w:t></w:r>') +
    numbered(2, '<w:r><w:t>(b)</w:t></w:r>') +
    numbered(2, bookmarked('clause', 'Clause (c)')) +
    numbered(3, '<w:r><w:t>(i)</w:t></w:r>') +
    numbered(3, bookmarked('item', 'Item (ii)')) +
    // The target index only holds REFERENCED names, so every probed bookmark needs a field.
    refField(' REF clause \\w ') +
    refField(' REF item \\r ') +
    refField(' REF sec \\w ') +
    refField(' REF art \\r ');

  const value = (bookmark: string, numberSwitch: 'r' | 'w' | 'n') =>
    contextUnder(LEGAL_NUMBERING, document(body))!.valueOf({
      bookmark,
      numberSwitch,
      hyperlink: false,
    });

  test('a deep target paints its ancestors, not its bare marker', () => {
    expect(value('clause', 'w')).toBe('1.2(c)');
    expect(value('item', 'r')).toBe('1.2(c)(ii)');
  });

  test('a level whose placeholder a deeper kept text displays is dropped once, not twice', () => {
    // lvl0's %1 appears in lvl1's `%1.%2`, so `1.` is dropped and the result is not `1.1.2`.
    expect(value('sec', 'w')).toBe('1.2');
    // The shallowest target keeps only itself; the bare trailing period trims.
    expect(value('art', 'r')).toBe('1');
  });

  test('w:isLgl renders inherited placeholders decimal in the composition too', () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/>
          <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:isLgl/>
          <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
    `;
    const part = document(
      numbered(0, '<w:r><w:t>I.</w:t></w:r>') +
        numbered(1, bookmarked('lgl', 'legal item')) +
        refField(' REF lgl \\w ')
    );
    const context = contextUnder(numbering, part)!;
    // The upperRoman `%1` renders decimal under the legal level, exactly as its marker does:
    // `1.1`, never `I.1`.
    expect(context.valueOf({ bookmark: 'lgl', numberSwitch: 'w', hyperlink: false })).toBe('1.1');
  });

  test('a bullet target still falls back to the cached result, never a glyph', () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
          <w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
    `;
    const part = document(numbered(0, bookmarked('b', 'bulleted')) + refField(' REF b \\r '));
    const context = contextUnder(numbering, part)!;
    expect(context.valueOf({ bookmark: 'b', numberSwitch: 'r', hyperlink: false })).toBeNull();
  });
});
