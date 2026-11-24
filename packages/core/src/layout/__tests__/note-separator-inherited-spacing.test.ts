import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { layoutNoteSeparator } from '../note-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

// A plain footnote separator paragraph takes its space after from the whole paragraph cascade,
// like any paragraph. Word reference renders show the first note 12 pt further below the rule
// when the Normal style sets 12 pt after. Only the application default for an omitted
// `w:pPrDefault` stays off the separator.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text) => text.length * 5,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};

function parse(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

/** A separator note whose one paragraph holds `pPr` and the separator mark. */
function separatorPart(pPr = '') {
  return parse(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p>${pPr}<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:separator/></w:r></w:p></w:footnote></w:footnotes>`,
    '/word/footnotes.xml'
  );
}

/** A styles part with optional `w:pPrDefault` content and Normal paragraph properties. */
function cascade(options: { defaults?: string | null; normal?: string; normalBasedOn?: string }) {
  const pPrDefault =
    options.defaults === null
      ? ''
      : `<w:pPrDefault><w:pPr>${options.defaults ?? ''}</w:pPr></w:pPrDefault>`;
  const base = options.normalBasedOn
    ? `<w:style w:type="paragraph" w:styleId="Base"><w:pPr>${options.normalBasedOn}</w:pPr></w:style>`
    : '';
  const basedOn = options.normalBasedOn ? '<w:basedOn w:val="Base"/>' : '';
  const styles = parse(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault>${pPrDefault}</w:docDefaults>` +
      `${base}<w:style w:type="paragraph" w:default="1" w:styleId="Normal">${basedOn}<w:pPr>${options.normal ?? ''}</w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Plain"><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    '/word/styles.xml'
  );
  return buildStyleCascadeTable(styles.root);
}

function separatorHeight(styleCascade: ReturnType<typeof cascade>, pPr = '') {
  return layoutNoteSeparator(
    separatorPart(pPr),
    'separator',
    400,
    { measurer, producer: 'separator-spacing-test', styleCascade },
    'footnote'
  ).flowHeight;
}

describe('footnote separator space after', () => {
  // The 12 pt mark line alone; every case below adds 12 pt after (w:after="240") or nothing.
  const LINE = 12;

  test('keeps space after from the Normal style', () => {
    expect(separatorHeight(cascade({ normal: '<w:spacing w:after="240"/>' }))).toBe(LINE + 12);
  });

  test('keeps space after from a style the Normal style is based on', () => {
    expect(separatorHeight(cascade({ normalBasedOn: '<w:spacing w:after="240"/>' }))).toBe(
      LINE + 12
    );
  });

  test('keeps space after from an authored w:pPrDefault', () => {
    expect(separatorHeight(cascade({ defaults: '<w:spacing w:after="240"/>' }))).toBe(LINE + 12);
  });

  test('keeps space after from a named paragraph style and from direct spacing', () => {
    const styles = cascade({ normal: '<w:spacing w:after="240"/>' });
    expect(separatorHeight(styles, '<w:pPr><w:pStyle w:val="Plain"/></w:pPr>')).toBe(LINE + 12);
    expect(separatorHeight(cascade({}), '<w:pPr><w:spacing w:after="240"/></w:pPr>')).toBe(
      LINE + 12
    );
  });

  test('stops at a w:basedOn cycle', () => {
    const styles = parse(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>` +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:basedOn w:val="Loop"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Loop"><w:basedOn w:val="Normal"/></w:style></w:styles>',
      '/word/styles.xml'
    );
    expect(separatorHeight(buildStyleCascadeTable(styles.root))).toBe(LINE);
  });

  test('direct zero spacing overrides inherited space after', () => {
    const styles = cascade({ normal: '<w:spacing w:after="240"/>' });
    expect(separatorHeight(styles, '<w:pPr><w:spacing w:after="0"/></w:pPr>')).toBe(LINE);
  });

  test('drops only the application default of an omitted w:pPrDefault', () => {
    // An omitted pPrDefault supplies 8 pt after and 278/240 auto line spacing (ECMA-376 Part 1, §17.7.5.3).
    // The separator keeps the line spacing but not that trailing space.
    const omitted = separatorHeight(cascade({ defaults: null }));
    const authoredEmpty = separatorHeight(cascade({}));
    expect(authoredEmpty).toBe(LINE);
    expect(omitted).toBeCloseTo((LINE * 278) / 240, 6);
  });
});
