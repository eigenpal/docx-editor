import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  detectBodyTocs,
  readOoxmlPart,
  TOC_LEVEL_INDENT_TWIPS,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  buildStyleCascadeTable,
  emptyTocPlaceholderParagraphIds,
  layoutSemanticDocument,
  paragraphFragmentsOf,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RIGHT_MARGIN_PT = 468;
const INDENT_STEP_PT = TOC_LEVEL_INDENT_TWIPS / 20;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// Word's own shape: begin, the instruction and the separator open the field INSIDE the first
// entry's paragraph, followed by that entry's text. Verified against the TOC in a saved
// corpus document, whose opening paragraph carries a `w:hyperlink` with the first heading, a tab
// and its PAGEREF. A paragraph holding ONLY the opening is a different shape, covered below.
const TOC_FIELD =
  '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-2" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>Introduction</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

/** The opening alone in its own paragraph: no result of its own, so no row. */
const CHROME_ONLY_OPENING =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-2" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

const EMPTY_TOC_FIELD =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-5" \\h </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

test('TOC result formatting ignores the Hyperlink style with a numeric style ID', () => {
  const styles = readOoxmlPart(
    '<w:styles xmlns:w="' +
      W +
      '"><w:style w:styleId="37" w:type="character"><w:name w:val="Hyperlink"/>' +
      '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:styleId="Custom" w:type="character"><w:name w:val="Custom link"/>' +
      '<w:rPr><w:color w:val="008033"/><w:u w:val="single"/></w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'application/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  const run = (text: string, id = '37', direct = '') =>
    '<w:r><w:rPr><w:rStyle w:val="' + id + '"/>' + direct + '</w:rPr><w:t>' + text + '</w:t></w:r>';
  const row =
    '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="4800"/></w:tabs></w:pPr>' +
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK \\l "_TocAlpha" </w:instrText>' +
    '<w:fldChar w:fldCharType="separate"/></w:r>' +
    run('Entry') +
    '<w:r><w:tab/><w:t>2</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const toc = CHROME_ONLY_OPENING.replace(
    '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>',
    row +
      '<w:p>' +
      run('Authored', '37', '<w:color w:val="A02030"/>') +
      run('Custom', 'Custom') +
      '</w:p>'
  );
  const layout = layoutSemanticDocument(load(toc + '<w:p>' + run('Outside') + '</w:p>'), 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: buildStyleCascadeTable(styles.part.root),
  });
  const spans = layout.pages
    .flatMap((page) => paragraphFragmentsOf(page))
    .flatMap((fragment) => fragment.lines)
    .flatMap((line) => line.spans);
  const entry = spans.find((span) => span.text === 'Entry')!;
  const leader = spans.find((span) => span.tabLeader === 'dot')!;
  expect(entry.style).toMatchObject({ color: null, underline: null });
  expect(leader.style.underline).toBeNull();
  // Outside a link the style stays: direct color wins, and the style still adds its underline.
  expect(spans.find((span) => span.text === 'Authored')!.style).toMatchObject({
    color: 'A02030',
    underline: { variant: 'single' },
  });
  expect(spans.find((span) => span.text === 'Custom')!.style).toMatchObject({
    color: '008033',
    underline: { variant: 'single' },
  });
  expect(spans.find((span) => span.text === 'Outside')!.style).toMatchObject({
    color: '0563C1',
    underline: { variant: 'single' },
  });
});

describe('TOC field chrome layout', () => {
  test('an opening that carries the first entry keeps its row above the closing line', () => {
    const part = load(`<w:sdt><w:sdtPr/><w:sdtContent>${TOC_FIELD}</w:sdtContent></w:sdt>`);
    const toc = detectBodyTocs(part)[0]!;
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    const opening = fragments.find((fragment) => fragment.paragraphId === toc.beginParagraphId);
    // The opening paragraph IS the first entry, so suppressing it would delete a real row and
    // shift every following entry up a line.
    expect(opening).toBeDefined();
    expect(opening!.box.y).toBe(0);
    expect(
      opening!.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
    ).toContain('Introduction');
    // The separate closing paragraph holds only the end field character, but its mark
    // still occupies the line below the entry, also inside a content control.
    const closing = fragments.find((fragment) => fragment.paragraphId === toc.endParagraphId);
    expect(closing?.box.y).toBe(opening!.box.y + opening!.box.height);
  });

  test('a bare populated TOC keeps the height of its separate closing paragraph before a table', () => {
    const end = '<w:fldChar w:fldCharType="end"/>';
    const closing = TOC_FIELD.replace(
      `<w:p><w:r>${end}</w:r></w:p>`,
      `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr><w:r>${end}</w:r></w:p>`
    );
    const inline = TOC_FIELD.replace(
      `</w:p><w:p><w:r>${end}</w:r></w:p>`,
      `<w:r>${end}</w:r></w:p>`
    );
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Following table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const render = (field: string) => {
      const part = load(field + table);
      const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
      const firstPage = layout.pages[0]!;
      const ending = paragraphFragmentsOf(firstPage).find(
        (fragment) => fragment.paragraphId === detectBodyTocs(part)[0]!.endParagraphId
      );
      return {
        closingHeight: ending?.box.height,
        tableTop: firstPage.fragments.find((fragment) => fragment.kind === 'table')!.box.y,
      };
    };
    const authored = render(closing);
    expect(authored.closingHeight).toBe(18);
    expect(authored.tableTop - render(inline).tableTop).toBe(18);
  });

  test('an opening holding only field chrome contributes no row', () => {
    const part = load(
      `<w:sdt><w:sdtPr/><w:sdtContent>${CHROME_ONLY_OPENING}</w:sdtContent></w:sdt>`
    );
    const toc = detectBodyTocs(part)[0]!;
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    expect(
      fragments.find((fragment) => fragment.paragraphId === toc.beginParagraphId)
    ).toBeUndefined();
    const entry = fragments.find((fragment) => fragment.paragraphId === toc.resultParagraphIds[0]);
    expect(entry).toBeDefined();
    // No blank row above it.
    expect(entry!.box.y).toBe(0);
  });

  test('instruction-only opening stays suppressed when the separator starts the first entry', () => {
    // Opening paragraph keeps begin and the instruction; the separator moves to the entry.
    const field = CHROME_ONLY_OPENING.replace('<w:fldChar w:fldCharType="separate"/>', '').replace(
      '<w:t>Introduction</w:t>',
      '<w:fldChar w:fldCharType="separate"/><w:t>Introduction</w:t>'
    );
    const part = load(field);
    const toc = detectBodyTocs(part)[0]!;
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    expect(fragments.some((fragment) => fragment.paragraphId === toc.beginParagraphId)).toBe(false);
    const entry = fragments.find((fragment) => fragment.paragraphId === toc.resultParagraphIds[0])!;
    expect(entry.box.y).toBe(0);
  });

  test('empty TOC keeps one begin-paragraph placeholder line', () => {
    const part = load(`<w:sdt><w:sdtPr/><w:sdtContent>${EMPTY_TOC_FIELD}</w:sdtContent></w:sdt>`);
    const toc = detectBodyTocs(part)[0]!;
    expect(emptyTocPlaceholderParagraphIds(part).has(toc.beginParagraphId)).toBe(true);
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    const placeholder = fragments.find((fragment) => fragment.paragraphId === toc.beginParagraphId);
    expect(placeholder).toBeDefined();
    expect(placeholder!.box.height).toBeGreaterThan(0);
    expect(
      fragments.find((fragment) => fragment.paragraphId === toc.endParagraphId)
    ).toBeUndefined();
  });

  test('replaceTocResult keeps an entry sharing the opening paragraph flush with the block top', () => {
    const stale =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
      '<w:p></w:p>' +
      '<w:p></w:p>' +
      '<w:p><w:r><w:t>Old</w:t></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    let part = load(`<w:sdt><w:sdtPr/><w:sdtContent>${stale}</w:sdtContent></w:sdt>`);
    const toc = detectBodyTocs(part)[0]!;
    expect(toc.resultParagraphIds).toHaveLength(3);
    const replaced = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries: [
        {
          level: 0,
          text: 'Fresh entry',
          headingParagraphId: 'heading-1',
          bookmarkName: '_Toc1',
          pageNumberText: '2',
        },
      ],
      bookmarksToCreate: [],
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    part = replaced.part;
    const tocAfter = detectBodyTocs(part)[0]!;
    expect(tocAfter.resultParagraphIds).toHaveLength(1);
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    const entry = fragments.find(
      (fragment) => fragment.paragraphId === tocAfter.resultParagraphIds[0]
    );
    expect(tocAfter.resultParagraphIds[0]).toBe(tocAfter.beginParagraphId);
    expect(entry!.box.y).toBe(0);
    expect(entry!.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')).toContain(
      'Fresh entry'
    );
  });

  test('ordinary empty paragraphs still publish a caret line', () => {
    const part = load('<w:p/>');
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragment = paragraphFragmentsOf(layout.pages[0]!)[0]!;
    expect(fragment.lines).toHaveLength(1);
    expect(fragment.box.height).toBeGreaterThan(0);
  });

  test('nested TOC entries indent monotonically through level five', () => {
    const stale =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Old</w:t></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    let part = load(`<w:sdt><w:sdtPr/><w:sdtContent>${stale}</w:sdtContent></w:sdt>`);
    const toc = detectBodyTocs(part)[0]!;
    const entries = [0, 1, 2, 3, 4].map((level) => ({
      level,
      text: `Heading level ${level + 1}`,
      headingParagraphId: `heading-${level}`,
      bookmarkName: `_Toc${level}`,
      pageNumberText: String(level + 1),
    }));
    const replaced = applyTreeOp(part, {
      op: 'replaceTocResult',
      tocId: toc.id,
      entries,
      bookmarksToCreate: [],
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    part = replaced.part;
    const tocAfter = detectBodyTocs(part)[0]!;
    const layout = layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) });
    const fragments = layout.pages
      .flatMap((page) => paragraphFragmentsOf(page))
      .filter((fragment) => tocAfter.resultParagraphIds.includes(fragment.paragraphId));

    expect(fragments).toHaveLength(5);
    const offsets = fragments.map((fragment) => fragment.lines[0]!.spans[0]!.box.x);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index]! - offsets[index - 1]!).toBeCloseTo(INDENT_STEP_PT, 6);
    }
    expect(offsets[0]).toBeCloseTo(0, 6);
    expect(offsets[4]).toBeCloseTo(INDENT_STEP_PT * 4, 6);

    for (const fragment of fragments) {
      const tabLine = fragment.lines.find((line) =>
        line.spans.some((span) => span.text === '\t' && span.tabLeader === 'dot')
      );
      expect(tabLine).toBeDefined();
      const pageNumber = tabLine!.spans[tabLine!.spans.length - 1]!;
      expect(pageNumber.box.x + pageNumber.box.width).toBeCloseTo(RIGHT_MARGIN_PT, 6);
    }
  });
});
