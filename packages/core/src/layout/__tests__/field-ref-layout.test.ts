// REF fields through full layout: live values from bookmark targets and resolved numbering.
//
// The stale-cache scenario this pins: a REF field's paragraph is byte-identical after a
// renumbering edit elsewhere — its node, width and producer all validate every other memo —
// so only the resolved-value token in its cache and flow keys can repaint it. The sharp test
// below edits the tree the way the store does (structural sharing: every unchanged node kept
// BY IDENTITY) and compares the warm session pass against a cold oracle.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf } from '../index.ts';
import type { SemanticLayout } from '../index.ts';
import { buildNumberingIndex } from '../numbering-index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function numberingIndexOf() {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}
const numberingIndex = numberingIndexOf();

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const numbered = (inner: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>${inner}</w:p>`;
const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
/** A complex REF with a deliberately stale cached result. */
const refField = (instr: string, cached = 'stale') =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t>${cached}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const refParagraph = (instr: string, cached = 'stale') =>
  `<w:p><w:r><w:t>see </w:t></w:r>${refField(instr, cached)}</w:p>`;

/** Every fragment's text per page — what a reader sees, independent of node identity. */
const shapeOf = (layout: SemanticLayout): unknown =>
  layout.pages.map((page) =>
    paragraphFragmentsOf(page).map((fragment) => ({
      y: fragment.box.y,
      text: fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim(),
    }))
  );

const textsOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    paragraphFragmentsOf(page).map((fragment) =>
      fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim()
    )
  );

function layoutOf(body: string): SemanticLayout {
  return layoutSemanticDocument(load(body), 1, { measurer, numberingIndex });
}

describe('complex REF fields resolve live in body layout', () => {
  test('a number-switch REF paints the resolved number over the stale cache', () => {
    const layout = layoutOf(
      numbered(bookmarked('_RefA', 'First')) +
        numbered(bookmarked('_RefB', 'Second')) +
        refParagraph(' REF _RefB \\r \\h \\* MERGEFORMAT ', '9.9')
    );
    expect(textsOf(layout)).toContain('see 2');
    expect(textsOf(layout).join('|')).not.toContain('9.9');
  });

  test('an instruction split across several w:instrText runs still resolves', () => {
    const split =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> REF _Re</w:instrText></w:r>' +
      '<w:r><w:instrText>fB \\r </w:instrText></w:r>' +
      '<w:r><w:instrText>\\* MERGEFORMAT </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>9.9</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const layout = layoutOf(
      numbered(bookmarked('_RefA', 'First')) + numbered(bookmarked('_RefB', 'Second')) + split
    );
    expect(textsOf(layout)).toContain('2');
  });

  test('a plain REF paints the bookmarked text', () => {
    const layout = layoutOf(
      `<w:p><w:r><w:t>The </w:t></w:r>${bookmarked('term', 'Closing Date')}` +
        `<w:r><w:t> occurs.</w:t></w:r></w:p>` +
        refParagraph(' REF term ')
    );
    expect(textsOf(layout)).toContain('see Closing Date');
  });

  test('missing bookmark, unnumbered target and unknown switch keep the cached result', () => {
    const layout = layoutOf(
      `<w:p>${bookmarked('plain', 'unnumbered')}</w:p>` +
        refParagraph(' REF _Nope \\r ', 'kept-a') +
        refParagraph(' REF plain \\r ', 'kept-b') +
        refParagraph(' REF plain \\p ', 'kept-c')
    );
    const texts = textsOf(layout);
    expect(texts).toContain('see kept-a');
    expect(texts).toContain('see kept-b');
    expect(texts).toContain('see kept-c');
  });

  test('\\n paints the number without its trailing period', () => {
    const layout = layoutOf(
      numbered(bookmarked('one', 'First')) + refParagraph(' REF one \\n ', '7')
    );
    expect(textsOf(layout)).toContain('see 1');
  });
});

describe('w:fldSimple REF fields resolve live', () => {
  test('the simple shape replaces its stale cached display', () => {
    const layout = layoutOf(
      numbered(bookmarked('_RefA', 'First')) +
        numbered(bookmarked('_RefB', 'Second')) +
        '<w:p><w:fldSimple w:instr=" REF _RefB \\r \\h "><w:r><w:t>9.9</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(textsOf(layout)).toContain('2');
    expect(textsOf(layout).join('|')).not.toContain('9.9');
  });

  test('an unsupported simple REF keeps its cached display', () => {
    const layout = layoutOf(
      numbered(bookmarked('_RefA', 'First')) +
        '<w:p><w:fldSimple w:instr=" REF _RefA \\p "><w:r><w:t>cached</w:t></w:r></w:fldSimple></w:p>'
    );
    expect(textsOf(layout)).toContain('cached');
  });
});

describe('a REF inside a table cell resolves live', () => {
  test('cell paragraphs project the resolved number', () => {
    const table =
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/>' +
      refParagraph(' REF _RefB \\r ', '9.9') +
      '</w:tc></w:tr></w:tbl>';
    const layout = layoutOf(
      numbered(bookmarked('_RefA', 'First')) + numbered(bookmarked('_RefB', 'Second')) + table
    );
    expect(textsOf(layout)).toContain('see 2');
  });
});

/**
 * Replace the body's block list while keeping every surviving node BY IDENTITY — the shape a
 * `TreeDocumentStore` commit publishes, and the one that can leave per-node memos stale.
 */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

describe('a renumbering edit repaints dependent REF fields incrementally', () => {
  // The REF paragraph comes FIRST and never changes: its node survives the edit by identity,
  // so every memo keyed on it (prepared block, break cache, flow key) would happily serve the
  // pre-edit value. Removing a numbered paragraph BELOW it renumbers the target from 2 to 1.
  const body =
    refParagraph(' REF target \\r ', '9.9') +
    numbered('<w:r><w:t>gone soon</w:t></w:r>') +
    numbered(bookmarked('target', 'The section')) +
    '<w:p><w:r><w:t>tail</w:t></w:r></w:p>';

  test('the warm session pass equals the cold oracle after the edit', () => {
    const before = load(body);
    const options = {
      measurer,
      numberingIndex,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(before, 1, options);
    expect(textsOf(first)).toContain('see 2');

    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 1));
    // The REF paragraph node really is the same object — the hazard under test.
    expect(after.root === before.root).toBe(false);
    const warm = layoutSemanticDocument(after, 2, options);
    const oracle = layoutSemanticDocument(after, 1, { measurer, numberingIndex });
    expect(shapeOf(warm)).toEqual(shapeOf(oracle));
    expect(textsOf(warm)).toContain('see 1');
    expect(textsOf(warm).join('|')).not.toContain('see 2');
  });

  test('the differential is not vacuous: the two trees paint different references', () => {
    const before = layoutOf(body);
    const afterBody =
      refParagraph(' REF target \\r ', '9.9') +
      numbered(bookmarked('target', 'The section')) +
      '<w:p><w:r><w:t>tail</w:t></w:r></w:p>';
    expect(shapeOf(before)).not.toEqual(shapeOf(layoutOf(afterBody)));
  });

  test('a no-change pass over a REF document returns the previous pages by identity', () => {
    const part = load(body);
    const options = {
      measurer,
      numberingIndex,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(layoutSemanticDocument(part, 2, options).pages).toBe(first.pages);
  });
});
