// Paragraph spacing and bottom borders (task 7.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  MAX_PARAGRAPH_SPACING_PT,
  appliedSpaceBefore,
  collapsedSpaceBefore,
  paragraphBorders,
  paragraphSpacing,
} from '../paragraph-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  fragmentsOfParagraph,
  linesOf,
  type PageGeometry,
} from '../semantic-records.ts';
import { propertiesOf } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, geometry?: PageGeometry, revision = 1) =>
  layoutSemanticDocument(part, revision, { measurer, ...(geometry ? { geometry } : {}) });

const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;

const BOTTOM = (attrs: string) => `<w:pBdr><w:bottom ${attrs}/></w:pBdr>`;

describe('paragraphSpacing resolves w:spacing before/after', () => {
  test('twips convert to points', () => {
    expect(
      paragraphSpacing([{ localName: 'spacing', attributes: { before: '240', after: '200' } }])
    ).toEqual({ before: 12, after: 10 });
  });

  test('hostile and non-numeric values are clamped or dropped', () => {
    expect(
      paragraphSpacing([
        { localName: 'spacing', attributes: { before: '999999999', after: 'expression(1)' } },
      ])
    ).toEqual({ before: MAX_PARAGRAPH_SPACING_PT, after: 0 });
    expect(
      paragraphSpacing([{ localName: 'spacing', attributes: { before: '-400', after: '0' } }])
    ).toEqual({ before: 0, after: 0 });
  });

  test('adjacent collapse takes the larger gap, not the sum', () => {
    expect(collapsedSpaceBefore(12, 10)).toBe(2);
    expect(collapsedSpaceBefore(8, 10)).toBe(0);
    expect(collapsedSpaceBefore(10, 0)).toBe(10);
  });

  test('appliedSpaceBefore suppresses mid-section top-of-page before', () => {
    expect(appliedSpaceBefore(18, 0, true, false)).toBe(0);
    expect(appliedSpaceBefore(18, 0, true, true)).toBe(18);
    expect(appliedSpaceBefore(18, 10, false, false)).toBe(8);
  });
});

describe('paragraphBorders resolves w:pBdr bottom', () => {
  test('val/color/sz/space become a typed edge in points', () => {
    const part = load(
      paragraph('x', BOTTOM('w:val="single" w:sz="24" w:space="4" w:color="C00000"'))
    );
    const pPr = part.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    expect(paragraphBorders(pPr)).toEqual({
      bottom: { val: 'single', color: 'C00000', widthPt: 3, spacePt: 4 },
    });
  });

  test('nil/none and hostile colour/size are refused', () => {
    const nil = load(paragraph('x', BOTTOM('w:val="nil" w:sz="24"')));
    const pPr = nil.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    expect(paragraphBorders(pPr)).toEqual({});

    const hostile = load(
      paragraph('x', BOTTOM('w:val="single" w:sz="999999" w:space="999999" w:color="red"'))
    );
    const hostilePr = hostile.root.children[0]!.children[0]!.children.find(
      (child) => child.kind === 'paragraphProperties'
    );
    const edge = paragraphBorders(hostilePr).bottom!;
    expect(edge.color).toBeNull();
    expect(edge.widthPt).toBeLessThanOrEqual(12);
    expect(edge.spacePt).toBeLessThanOrEqual(3168);
  });
});

describe('layout accounts for spacing in pagination and fragment geometry', () => {
  test('before/after shift fragment boxes and the flow cursor', () => {
    const part = load(
      paragraph('one', '<w:spacing w:after="240"/>') +
        paragraph('two', '<w:spacing w:before="120"/>')
    );
    const layout = lay(part);
    const [first, second] = layout.pages[0]!.fragments;
    expect(first!.kind).toBe('paragraph');
    expect(second!.kind).toBe('paragraph');
    if (first!.kind !== 'paragraph' || second!.kind !== 'paragraph') return;
    // First ends with 12pt after; second asks for 6pt before → collapsed gap is 12pt.
    expect(first!.spacing).toEqual({ before: 0, after: 12 });
    expect(second!.spacing.before).toBe(0); // fully collapsed into the prior after
    expect(second!.box.y).toBe(first!.box.y + first!.box.height);
    expect(second!.lines[0]!.box.y - first!.lines[0]!.box.y).toBe(14 + 12);
  });

  test('explicit before is honoured on the first paragraph of a document/section', () => {
    const layout = lay(load(paragraph('title', '<w:spacing w:before="200"/>')));
    const [fragment] = layout.pages[0]!.fragments;
    expect(fragment!.kind).toBe('paragraph');
    if (fragment!.kind !== 'paragraph') return;
    expect(fragment!.spacing.before).toBe(10);
    expect(fragment!.box.y).toBe(0);
    expect(fragment!.lines[0]!.box.y).toBe(10);
  });

  test('spacing contributes to pagination', () => {
    // Content height 80pt; each plain line is 14pt. With 40pt after on every paragraph,
    // far fewer fit per page than without spacing.
    const many = Array.from({ length: 8 }, (_, index) =>
      paragraph(`line ${index}`, '<w:spacing w:after="800"/>')
    ).join('');
    const withSpacing = lay(load(many), SMALL);
    const plain = lay(
      load(Array.from({ length: 8 }, (_, index) => paragraph(`line ${index}`)).join('')),
      SMALL
    );
    expect(withSpacing.pages.length).toBeGreaterThan(plain.pages.length);
  });
});

describe('comprehensive fixture: bottom border rule and vertical spacing', () => {
  const FIXTURE =
    paragraph('above', '<w:spacing w:after="200"/>') +
    paragraph(
      '',
      `<w:spacing w:before="100" w:after="120"/>` +
        BOTTOM('w:val="single" w:sz="16" w:space="2" w:color="FF0000"')
    ) +
    paragraph('below', '<w:spacing w:before="40"/>');

  test('empty bordered paragraph occupies Word-like space and publishes the rule', () => {
    const part = load(FIXTURE);
    const layout = lay(part);
    const fragments = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
    expect(fragments).toHaveLength(3);
    const empty = fragments[1]!;
    if (empty.kind !== 'paragraph') return;

    // One caret line (empty paragraph), plus border space (2pt) + width (2pt) + after (6pt).
    expect(empty.lines).toHaveLength(1);
    expect(empty.lines[0]!.box.height).toBe(14);
    expect(empty.bottomBorder).toBeDefined();
    expect(empty.bottomBorder!.edge).toEqual({
      val: 'single',
      color: 'FF0000',
      widthPt: 2,
      spacePt: 2,
    });
    // Rule sits below the empty line by `space`.
    expect(empty.bottomBorder!.box.y).toBe(empty.lines[0]!.box.y + 14 + 2);
    expect(empty.bottomBorder!.box.height).toBe(2);
    expect(empty.bottomBorder!.box.width).toBe(empty.box.width);
    // Fragment height covers before remainder + line + border extent + after.
    expect(empty.box.height).toBe(
      empty.spacing.before + 14 + 2 + 2 + empty.spacing.after
    );
  });

  test('vertical spacing collapses against the prior after and advances the next paragraph', () => {
    const part = load(FIXTURE);
    const layout = lay(part);
    const fragments = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph');
    const [above, empty, below] = fragments;
    if (
      above!.kind !== 'paragraph' ||
      empty!.kind !== 'paragraph' ||
      below!.kind !== 'paragraph'
    )
      return;

    // above after=10pt, empty before=5pt → empty's applied before collapses to 0.
    expect(above!.spacing.after).toBe(10);
    expect(empty!.spacing.before).toBe(0);
    // empty after=6pt, below before=2pt → below collapses to 0; gap is empty's after.
    expect(empty!.spacing.after).toBe(6);
    expect(below!.spacing.before).toBe(0);
    expect(below!.box.y).toBe(empty!.box.y + empty!.box.height);
    expect(below!.lines[0]!.box.y).toBe(empty!.bottomBorder!.box.y + empty!.bottomBorder!.box.height + 6);
  });

  test('flattened props still round-trip spacing; borders resolve from the tree', () => {
    const part = load(FIXTURE);
    const emptyPara = part.root.children[0]!.children[1]!;
    const pPr = emptyPara.children.find((child) => child.kind === 'paragraphProperties');
    const props = propertiesOf(pPr);
    expect(paragraphSpacing(props)).toEqual({ before: 5, after: 6 });
    // propertiesOf does not flatten nested pBdr children — borders read the tree.
    expect(props.some((property) => property.localName === 'pBdr')).toBe(true);
    expect(paragraphBorders(pPr).bottom?.color).toBe('FF0000');
  });
});

describe('Word 2013+ top-of-page space-before suppression', () => {
  function firstParagraphOnPage(
    layout: ReturnType<typeof lay>,
    pageIndex: number
  ): Extract<
    NonNullable<ReturnType<typeof lay>['pages'][number]>['fragments'][number],
    { kind: 'paragraph' }
  > {
    const fragment = layout.pages[pageIndex]!.fragments.find((entry) => entry.kind === 'paragraph');
    expect(fragment?.kind).toBe('paragraph');
    if (!fragment || fragment.kind !== 'paragraph') {
      throw new Error(`expected paragraph on page ${pageIndex}`);
    }
    return fragment;
  }

  test('empty hard page-break paragraph suppresses before on the next page', () => {
    const layout = lay(
      load(
        paragraph('before') +
          '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
          paragraph('heading', '<w:spacing w:before="360"/>')
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const heading = firstParagraphOnPage(layout, 1);
    expect(heading.lines[0]!.spans.map((span) => span.text).join('')).toBe('heading');
    expect(heading.spacing.before).toBe(0);
    expect(heading.box.y).toBe(0);
    expect(heading.lines[0]!.box.y).toBe(0);
  });

  test('pageBreakBefore suppresses before at the top of the new page', () => {
    const layout = lay(
      load(
        paragraph('first') +
          paragraph('second', '<w:pageBreakBefore/><w:spacing w:before="200"/>')
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const second = firstParagraphOnPage(layout, 1);
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
    expect(second.spacing.before).toBe(0);
    expect(second.lines[0]!.box.y).toBe(0);
  });

  test('natural pagination suppresses before when a paragraph moves to the next page', () => {
    // Content height 80pt; first paragraph's after pushes the second onto page 2.
    const layout = lay(
      load(
        paragraph('first', '<w:spacing w:after="1200"/>') +
          paragraph('second', '<w:spacing w:before="200"/>')
      ),
      SMALL
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const second = firstParagraphOnPage(layout, 1);
    expect(second.lines[0]!.spans.map((span) => span.text).join('')).toBe('second');
    expect(second.spacing.before).toBe(0);
    expect(second.lines[0]!.box.y).toBe(0);
  });

  test('first paragraph after a section break retains before spacing', () => {
    const layout = lay(
      load(
        paragraph('cover') +
          '<w:p><w:pPr><w:sectPr>' +
          '<w:pgSz w:w="4000" w:h="4000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>' +
          '</w:sectPr></w:pPr></w:p>' +
          paragraph('body', '<w:spacing w:before="360"/>') +
          '<w:sectPr>' +
          '<w:pgSz w:w="4000" w:h="4000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>' +
          '</w:sectPr>'
      )
    );
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const body = firstParagraphOnPage(layout, 1);
    expect(body.lines[0]!.spans.map((span) => span.text).join('')).toBe('body');
    expect(body.spacing.before).toBe(18);
    expect(body.lines[0]!.box.y).toBe(18);
  });

  test('document-first paragraph retains explicit before', () => {
    const layout = lay(load(paragraph('title', '<w:spacing w:before="360"/>')));
    const title = firstParagraphOnPage(layout, 0);
    expect(title.spacing.before).toBe(18);
    expect(title.lines[0]!.box.y).toBe(18);
  });
});

describe('bottom border survives across a multi-line paragraph', () => {
  test('only the final fragment carries the rule', () => {
    const long = paragraph(
      Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '),
      BOTTOM('w:val="single" w:sz="8" w:space="1" w:color="000000"')
    );
    const layout = lay(load(long), SMALL);
    const fragments = fragmentsOfParagraph(layout, '/word/document.xml#0.0.0');
    expect(fragments.length).toBeGreaterThan(1);
    for (const fragment of fragments.slice(0, -1)) {
      expect(fragment.bottomBorder).toBeUndefined();
      expect(fragment.spacing.after).toBe(0);
    }
    const last = fragments[fragments.length - 1]!;
    expect(last.bottomBorder).toBeDefined();
    expect(last.bottomBorder!.box.y).toBeGreaterThan(
      last.lines[last.lines.length - 1]!.box.y
    );
  });
});

describe('linesOf still walks every line when spacing and borders are present', () => {
  test('source ranges remain contiguous', () => {
    const layout = lay(
      load(
        paragraph('hello', `<w:spacing w:after="200"/>${BOTTOM('w:val="single" w:sz="8"')}`)
      )
    );
    const lines = linesOf(layout);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.range).toMatchObject({ start: 0, end: 5 });
  });
});
