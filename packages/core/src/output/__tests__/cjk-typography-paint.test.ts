import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { layoutHeaderFooterStory } from '../../layout/hf-layout.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
function part(xml: string, name = '/word/document.xml') {
  const read = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
function documentPart(text: string, pPr = '<w:jc w:val="both"/>') {
  return part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/>${pPr}</w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
}
const geometry = { width: 50, height: 500, margin: { top: 10, bottom: 10, left: 10, right: 10 } };

test('CJK justification paints every gap and maps each caret to the same geometry', () => {
  const layout = layoutSemanticDocument(documentPart('天地玄黄月、日'), 0, { measurer, geometry });
  const first = layout.pages[0]!.fragments[0]!.lines[0]!;
  expect(first.spans.map((span) => span.text)).toEqual(['天', '地', '玄', '黄']);
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const painted = container.querySelectorAll<HTMLElement>('.docx-line:first-child [data-start]');
  expect(painted.length).toBe(4);
  expect([...painted].map((span) => span.style.marginLeft)).toEqual(['', '2px', '2px', '2px']);
  for (const span of first.spans) {
    const caret = caretAt(
      layout,
      { paragraphId: span.range.paragraphId, offset: span.range.start },
      measurer
    );
    expect(caret).not.toBeNull();
    expect(caret!.x).toBeCloseTo(span.box.x, 5);
  }
  const last = layout.pages[0]!.fragments[0]!.lines.at(-1)!;
  expect(last.spans.map((span) => span.text).join('')).toBe('月、日');
});

test('CJK compression uses the same spacing in layout and DOM paint', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
    '/word/settings.xml'
  );
  const styleCascade = buildStyleCascadeTable(null, undefined, settings.root);
  const layout = layoutSemanticDocument(documentPart('天。地。', ''), 0, {
    measurer,
    geometry,
    styleCascade,
  });
  const line = layout.pages[0]!.fragments[0]!.lines[0]!;
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const punctuation = [...container.querySelectorAll<HTMLElement>('[data-start]')].filter(
    (element) => element.textContent === '。'
  );
  expect(punctuation).toHaveLength(2);
  expect(punctuation.map((element) => element.style.letterSpacing)).toEqual(['-3px', '-3px']);
  expect(line.spans.at(-1)!.box.x + line.spans.at(-1)!.box.width - line.spans[0]!.box.x).toBe(18);
});

test('typography settings invalidate cached layout without a text edit', () => {
  const document = documentPart('天地玄黄。人', '');
  const session = createLayoutSession();
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  const initial = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    session,
    styleCascade: buildStyleCascadeTable(null),
  });
  const updated = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    session,
    styleCascade: buildStyleCascadeTable(null, undefined, settings.root),
  });
  const clean = layoutSemanticDocument(document, 0, {
    measurer,
    geometry,
    styleCascade: buildStyleCascadeTable(null, undefined, settings.root),
  });
  expect(updated.pages).toEqual(clean.pages);
  expect(JSON.stringify(updated.pages)).not.toBe(JSON.stringify(initial.pages));
});

test('headers and table cells consume the same document typography settings', () => {
  const settings = part(
    `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
  );
  const styleCascade = buildStyleCascadeTable(null, undefined, settings.root);
  const p =
    '<w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>天。地。</w:t></w:r></w:p>';
  const header = part(`<w:hdr xmlns:w="${W}">${p}</w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(header, 18, measurer, 'cjk-test', undefined, styleCascade);
  const headerParagraph = story.fragments[0]!;
  expect(headerParagraph.kind).toBe('paragraph');
  if (headerParagraph.kind !== 'paragraph') throw new Error('expected header paragraph');
  expect(headerParagraph.lines).toHaveLength(1);
  expect(headerParagraph.lines[0]!.spans.map((span) => span.text).join('')).toBe('天。地。');
  const table = part(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="360"/></w:tblGrid><w:tr><w:tc>${p}</w:tc></w:tr></w:tbl></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(table, 0, { measurer, geometry, styleCascade });
  const tableFragment = layout.pages[0]!.fragments[0]!;
  expect(tableFragment.kind).toBe('table');
  if (tableFragment.kind !== 'table') throw new Error('expected table');
  const cell = tableFragment.rows[0]!.cells[0]!.blocks[0]!;
  if (cell.kind !== 'paragraph') throw new Error('expected cell paragraph');
  expect(cell.lines).toHaveLength(1);
  expect(cell.lines[0]!.spans.map((span) => span.text).join('')).toBe('天。地。');
});
