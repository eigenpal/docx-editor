// Header STYLEREF number switches read the list number of the paragraph a page selects.
import { expect, test } from 'bun:test';
import { applyTreeOp, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutSemanticDocument, createLayoutSession } from '../semantic-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, style = '') =>
  `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (content: string, style = '', page = false, numPr = '') => {
  const props = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${numPr}${page ? '<w:pageBreakBefore/>' : ''}`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
};
/** Direct numbering that switches the style's list off, as a thesis does for back matter. */
const unnumbered = '<w:numPr><w:numId w:val="0"/></w:numPr>';
const field = (name: string, suffix = '') =>
  `<w:fldSimple w:instr=" STYLEREF ${name.replaceAll('"', '&quot;')} ${suffix}">${run('cached')}</w:fldSimple>`;
const bar = run('|');

function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

const numPr = (numId: number, ilvl: number) =>
  `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`;
const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>${numPr(5, 0)}</w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>${numPr(5, 1)}</w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>${numPr(5, 2)}</w:style>` +
      `<w:style w:type="paragraph" w:styleId="AppendixTitle"><w:name w:val="Appendix Title"/><w:basedOn w:val="Normal"/>${numPr(6, 0)}</w:style>` +
      '<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain Title"/><w:basedOn w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:styleId="Mark"><w:name w:val="Mark"/></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);
const numberingIndex = buildNumberingIndex(
  part(
    `<w:numbering xmlns:w="${W}">` +
      '<w:abstractNum w:abstractNumId="0">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="第%1章"/></w:lvl>' +
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:isLgl/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>' +
      '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%3)"/></w:lvl>' +
      '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="Appendix %1."/></w:lvl>' +
      '</w:abstractNum>' +
      '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>' +
      '</w:numbering>',
    '/word/numbering.xml'
  ).root
);
const measurer = createFixedMeasurer(5, 10);

function laidOut(body: string, header: string) {
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const hdr = part(`<w:hdr xmlns:w="${W}"><w:p>${header}</w:p></w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(hdr, 400, measurer, 'test', undefined, styles);
  const options = {
    measurer,
    styleCascade: styles,
    numberingIndex,
    geometry: {
      width: 420,
      height: 200,
      margin: { top: 30, bottom: 15, left: 10, right: 10 },
      headerDistance: 5,
    },
    furniture: {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default' as const, story]]),
      footers: new Map(),
    },
  };
  const session = createLayoutSession();
  const laid = layoutSemanticDocument(main, 1, { ...options, session });
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(warm)).toEqual(text(laid));
  return { laid, main, options, session };
}

function headers(body: string, header: string): string[] {
  return text(laidOut(body, header).laid);
}

function text(layout: SemanticLayout): string[] {
  return layout.pages.map((page) =>
    paragraphFragmentsOfBlocks(page.header?.fragments ?? [])
      .flatMap((f) => f.lines.flatMap((l) => l.spans.map((s) => s.text)))
      .join('')
  );
}

const thesis =
  para(run('Intro')) +
  para(run('Alpha'), 'Heading1', true) +
  para(run('Scope'), 'Heading2') +
  para(run('Detail'), 'Heading3') +
  para(run('Beta'), 'Heading1', true) +
  para(run('Method'), 'Heading2') +
  para(run('Data'), 'Heading2', true) +
  para(run('Sample'), 'Heading3') +
  para(run('Thanks'), 'Heading1', true, unnumbered);

test('\\n shows the selected paragraph number at its own level, \\w in full context', () => {
  const header = [
    field('"heading 1"', '\\n \\* MERGEFORMAT') + run(' ') + field('"heading 1"'),
    field('"heading 2"', '\\n'),
    field('"heading 3"', '\\n'),
    field('"heading 3"', '\\w'),
  ].join(bar);
  expect(headers(thesis, header)).toEqual([
    '第1章 Alpha|1.1|(1)|1.1(1)',
    '第1章 Alpha|1.1|(1)|1.1(1)',
    '第2章 Beta|2.1|(1)|1.1(1)',
    '第2章 Beta|2.2|(1)|2.2(1)',
    // A selected paragraph without a number reads as number zero.
    '0 Thanks|2.2|(1)|2.2(1)',
  ]);
});

test('number switches combine with \\l in either order', () => {
  const header = [
    field('"heading 2"', '\\l \\n'),
    field('"heading 2"', '\\n \\l'),
    field('"heading 2"', '\\n'),
  ].join(bar);
  expect(headers(thesis, header)).toEqual([
    '1.1|1.1|1.1',
    '1.1|1.1|1.1',
    '2.1|2.1|2.1',
    '2.2|2.2|2.2',
    '2.2|2.2|2.2',
  ]);
});

test('a number drops one trailing period and keeps its literal text', () => {
  const content = para(run('Body')) + para(run('Tables'), 'AppendixTitle', true);
  expect(headers(content, field('"Appendix Title"', '\\n'))).toEqual(['Appendix A', 'Appendix A']);
});

test('a paragraph style without numbering shows zero under \\n and \\w', () => {
  const content = para(run('Body')) + para(run('Preface'), 'Plain', true);
  const header = field('"Plain Title"', '\\n') + bar + field('"Plain Title"', '\\w');
  expect(headers(content, header)).toEqual(['0|0', '0|0']);
});

test('unsupported number shapes keep the cached result', () => {
  const content = thesis + para(run('a ') + run('marked', 'Mark'));
  const header = [
    field('"heading 2"', '\\r'),
    field('"heading 2"', '\\n \\t'),
    field('"heading 2"', '\\p'),
    field('"heading 2"', '\\n \\w'),
    field('Mark', '\\n'),
  ].join(bar);
  expect(headers(content, header)).toEqual(Array(5).fill('cached|cached|cached|cached|cached'));
});

function paragraphsOf(doc: OoxmlPart): OoxmlNode[] {
  const bodyNode = doc.root.children.find((node) => node.kind === 'body')!;
  if (bodyNode.kind === 'textValue') throw Error('body');
  return bodyNode.children.filter((node) => node.kind === 'paragraph');
}

test('a renumbering edit updates header numbers on a warm layout', () => {
  const header = field('"heading 1"', '\\n') + bar + field('"heading 2"', '\\n');
  const f = laidOut(thesis, header);
  expect(text(f.laid)).toEqual(['第1章|1.1', '第1章|1.1', '第2章|2.1', '第2章|2.2', '0|2.2']);
  // Restyle the opening paragraph as a chapter: every later number moves up by one.
  const intro = paragraphsOf(f.main)[0]!;
  const edit = applyTreeOp(f.main, {
    op: 'setParagraphProperties',
    paragraphId: intro.id,
    properties: [{ localName: 'pStyle', attributes: { val: 'Heading1' } }],
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  const warm = layoutSemanticDocument(edit.part, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(edit.part, 2, f.options);
  expect(text(warm)).toEqual(['第1章|2.1', '第2章|2.1', '第3章|3.1', '第3章|3.2', '0|3.2']);
  expect(warm.pages).toEqual(cold.pages);
});

/** A complex field whose instruction spans two runs. */
const complexField = (name: string, suffix: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> STYLEREF ${name} </w:instrText></w:r>` +
  `<w:r><w:instrText xml:space="preserve">${suffix} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('cached')}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

test('complex fields with a split instruction read the same numbers', () => {
  const header = complexField('"heading 2"', '\\n') + bar + complexField('"heading 3"', '\\w \\l');
  expect(headers(thesis, header)).toEqual([
    '1.1|1.1(1)',
    '1.1|1.1(1)',
    '2.1|1.1(1)',
    '2.2|2.2(1)',
    '2.2|2.2(1)',
  ]);
});

test('a tracked paragraph style change selects the style each view shows', () => {
  const restyled =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/>' +
    '<w:pPrChange w:id="2" w:author="A" w:date="2024-01-01T00:00:00Z">' +
    '<w:pPr><w:pStyle w:val="Plain"/><w:pageBreakBefore/></w:pPr></w:pPrChange></w:pPr>' +
    `${run('Restyled')}</w:p>`;
  const body =
    para(run('Intro')) +
    para(run('Alpha'), 'Heading1', true) +
    para(run('Beta'), 'Heading1', true) +
    restyled;
  const header = field('"heading 1"', '\\n') + run(' ') + field('"heading 1"');
  const { options } = laidOut(body, header);
  const view = (displayMode: 'proposed' | 'original') =>
    text(
      layoutSemanticDocument(
        part(
          `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
          '/word/document.xml'
        ),
        1,
        { ...options, displayMode }
      )
    );
  expect(view('proposed')).toEqual(['第1章 Alpha', '第1章 Alpha', '第2章 Beta', '第3章 Restyled']);
  expect(view('original')).toEqual(['第1章 Alpha', '第1章 Alpha', '第2章 Beta', '第2章 Beta']);
});
