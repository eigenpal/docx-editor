// `w:doNotUseHTMLParagraphAutoSpacing` (§17.15.3): the space after one paragraph and the
// space before the next add up instead of collapsing to the larger of the two.
//
// Each paragraph carries 12pt before and 12pt after. Collapsed, the second line sits one line
// plus 12pt below the first; summed, one line plus 24pt.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { adjacentParagraphSpacingSettings } from '../adjacent-paragraph-spacing.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { keepNextGroupHeight } from '../pagination-keeps.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import {
  paragraphFragmentsOf,
  type ParagraphFragmentRecord,
  type SemanticLayout,
} from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);
const FLAG = '<w:doNotUseHTMLParagraphAutoSpacing/>';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style></w:styles>`;

const settingsPart = (compat: string) =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
    '/word/settings.xml'
  );

const cascade = (compat = '') =>
  buildStyleCascadeTable(
    read(STYLES, '/word/styles.xml').root,
    undefined,
    settingsPart(compat).root
  );

const paragraph = (text: string, spacing = 'w:before="240" w:after="240"', extra = '') =>
  `<w:p><w:pPr>${extra}<w:spacing ${spacing}/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const TWO = paragraph('One') + paragraph('Two');

function document(body: string): OoxmlPart {
  return read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
}

function layout(
  body: string,
  compat = '',
  height = 400,
  session?: ReturnType<typeof createLayoutSession>
): SemanticLayout {
  return layoutSemanticDocument(document(body), 1, {
    measurer,
    styleCascade: cascade(compat),
    geometry: { width: 400, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    ...(session ? { session } : {}),
  });
}

const firstLineY = (fragment: ParagraphFragmentRecord) => fragment.lines[0]!.box.y;

/** Distance between the first lines of the first two body paragraphs on page one. */
function bodyPitch(body: string, compat = ''): number {
  const [first, second] = paragraphFragmentsOf(layout(body, compat).pages[0]!);
  return firstLineY(second!) - firstLineY(first!);
}

function cellParagraphs(result: SemanticLayout): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const fragment of result.pages[0]!.fragments) {
    if (fragment.kind !== 'table') continue;
    for (const row of fragment.rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) if (block.kind === 'paragraph') found.push(block);
      }
    }
  }
  return found;
}

const NO_SPACING = 'w:before="0" w:after="0"';
/** Line pitch with no paragraph spacing at all. */
const LINE = bodyPitch(paragraph('One', NO_SPACING) + paragraph('Two', NO_SPACING));

describe('reading the setting', () => {
  test('presence, and every ST_OnOff spelling', () => {
    const read = (compat: string) =>
      adjacentParagraphSpacingSettings(settingsPart(compat).root).sumAdjacentParagraphSpacing ??
      false;
    expect(read('')).toBe(false);
    expect(read(FLAG)).toBe(true);
    for (const on of ['1', 'true', 'on']) {
      expect(read(`<w:doNotUseHTMLParagraphAutoSpacing w:val="${on}"/>`)).toBe(true);
    }
    for (const off of ['0', 'false', 'off']) {
      expect(read(`<w:doNotUseHTMLParagraphAutoSpacing w:val="${off}"/>`)).toBe(false);
    }
  });

  test('only a compat child of settings counts', () => {
    const outside = read(`<w:settings xmlns:w="${W}">${FLAG}</w:settings>`, '/word/settings.xml');
    expect(adjacentParagraphSpacingSettings(outside.root)).toEqual({});
    expect(adjacentParagraphSpacingSettings(null)).toEqual({});
  });

  test('the setting is part of the cascade cache identity; an off value is not', () => {
    expect(cascade(FLAG).cacheToken).not.toBe(cascade().cacheToken);
    expect(cascade('<w:doNotUseHTMLParagraphAutoSpacing w:val="0"/>').cacheToken).toBe(
      cascade().cacheToken
    );
  });

  test('the settings part keeps the element on save', () => {
    const part = settingsPart(FLAG);
    expect(serializeOoxmlPart(part)).toContain('doNotUseHTMLParagraphAutoSpacing');
  });
});

describe('body paragraphs', () => {
  test('collapse by default and add up with the setting', () => {
    expect(bodyPitch(TWO)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(TWO, FLAG)).toBeCloseTo(LINE + 24, 6);
    expect(bodyPitch(TWO, '<w:doNotUseHTMLParagraphAutoSpacing w:val="off"/>')).toBeCloseTo(
      LINE + 12,
      6
    );
  });

  test('unequal gaps add up instead of taking the larger one', () => {
    const body = paragraph('One', 'w:after="120"') + paragraph('Two', 'w:before="240"');
    expect(bodyPitch(body)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 18, 6);
  });

  test('the second paragraph publishes the before-spacing it applied', () => {
    const second = paragraphFragmentsOf(layout(TWO, FLAG).pages[0]!)[1]!;
    expect(second.spacing.before).toBe(12);
    expect(paragraphFragmentsOf(layout(TWO).pages[0]!)[1]!.spacing.before).toBe(0);
  });

  test('contextual spacing still removes the gap between same-style paragraphs', () => {
    const contextual = '<w:contextualSpacing/>';
    const same = paragraph('One', undefined, contextual) + paragraph('Two', undefined, contextual);
    expect(bodyPitch(same, FLAG)).toBeCloseTo(LINE, 6);
    const other = '<w:pStyle w:val="Other"/>';
    const mixed =
      paragraph('One', undefined, contextual) + paragraph('Two', undefined, other + contextual);
    expect(bodyPitch(mixed, FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('before-spacing is still dropped at the top of a page the paragraph moved to', () => {
    // 12 + LINE + 12 leaves about 13pt on a 50pt page: not enough for 12pt before and a line.
    const result = layout(TWO, FLAG, 50);
    expect(result.pages).toHaveLength(2);
    const moved = paragraphFragmentsOf(result.pages[1]!)[0]!;
    expect(moved.spacing.before).toBe(0);
    expect(firstLineY(moved)).toBe(0);
  });

  test('a sum that no longer fits moves the paragraph where the collapsed gap fits', () => {
    // Collapsed, the second line ends 12pt above where the summed one does, either side of 60.
    expect(12 + LINE + 12 + LINE).toBeLessThan(60);
    expect(12 + LINE + 24 + LINE).toBeGreaterThan(60);
    expect(layout(TWO, '', 60).pages).toHaveLength(1);
    expect(layout(TWO, FLAG, 60).pages).toHaveLength(2);
  });

  test('a keep-with-next chain is priced with the summed gap', () => {
    // Priced collapsed, the chain would seem to fit and the kept paragraph would stay behind.
    const body =
      paragraph('One') + paragraph('Two', undefined, '<w:keepNext/>') + paragraph('Three');
    const pages = (compat: string) =>
      layout(body, compat, 92).pages.map((page) =>
        paragraphFragmentsOf(page).map((fragment) => fragment.lines[0]!.spans[0]!.text)
      );
    expect(pages('')).toEqual([['One', 'Two', 'Three']]);
    expect(pages(FLAG)).toEqual([['One'], ['Two', 'Three']]);
  });

  test('paragraphs sharing a frame add up with the setting', () => {
    const frame = '<w:framePr w:w="3000" w:hAnchor="page" w:vAnchor="page" w:x="400" w:y="400"/>';
    const body = paragraph('One', undefined, frame) + paragraph('Two', undefined, frame);
    expect(bodyPitch(body)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('a layout session does not reuse placement from the other rule', () => {
    const session = createLayoutSession();
    const body = TWO + paragraph('Three');
    for (const compat of ['', FLAG, '']) {
      const warm = layout(body, compat, 400, session);
      expect(warm.pages).toEqual(layout(body, compat).pages);
    }
  });
});

describe('other stories', () => {
  test('table cell paragraphs add up with the setting', () => {
    const table = `<w:tbl><w:tr><w:tc>${TWO}</w:tc></w:tr></w:tbl>`;
    const pitch = (compat: string) => {
      const [first, second] = cellParagraphs(layout(table, compat));
      return firstLineY(second!) - firstLineY(first!);
    };
    expect(pitch('')).toBeCloseTo(LINE + 12, 6);
    expect(pitch(FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('header paragraphs add up with the setting', () => {
    const header = read(`<w:hdr xmlns:w="${W}">${TWO}</w:hdr>`, '/word/header1.xml');
    const pitch = (compat: string) => {
      const [first, second] = layoutHeaderFooterStory(
        header,
        400,
        measurer,
        'test',
        undefined,
        cascade(compat)
      ).fragments.filter((fragment) => fragment.kind === 'paragraph');
      return firstLineY(second!) - firstLineY(first!);
    };
    expect(pitch('')).toBeCloseTo(LINE + 12, 6);
    expect(pitch(FLAG)).toBeCloseTo(LINE + 24, 6);
  });
});

describe('keep-with-next pricing', () => {
  const keeps = (keepNext: boolean) => ({ keepNext, keepLines: false, widowControl: false });
  const blocks = [
    { kind: 'paragraph', spacing: { before: 12, after: 12 }, keeps: keeps(true) },
    { kind: 'paragraph', spacing: { before: 12, after: 12 }, keeps: keeps(false) },
  ];
  const lines = () => [{ height: 14 }];

  test('prices the summed gap between chain members', () => {
    expect(keepNextGroupHeight(blocks, 0, 0, lines)).toBe(12 + 14 + 12 + 14);
    expect(keepNextGroupHeight(blocks, 0, 0, lines, undefined, undefined, true)).toBe(
      12 + 14 + 12 + 12 + 14
    );
  });
});
