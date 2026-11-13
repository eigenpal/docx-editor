// Paragraph borders through the protocol: `getParagraphBorders` and `setParagraphFormat.borders`.
//
// A read answers what the page shows, through the style cascade. A write states the paragraph's
// whole `w:pBdr`, copying a style's edges first, so the result is the same whichever way a reader
// combines the paragraph's element with its style's.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  open,
  p,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type { AutomationParagraphBordersWrite } from '../paragraph-borders.ts';

const RULED_STYLE =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Ruled"><w:name w:val="Ruled"/>' +
  '<w:pPr><w:pBdr><w:top w:val="double" w:sz="6" w:space="1" w:color="FF0000"/>' +
  '<w:bottom w:val="single" w:sz="12" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:style>';

const ruled = (text: string): string =>
  `<w:p><w:pPr><w:pStyle w:val="Ruled"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function bordersOf(host: AutomationHost, paragraph: AutomationHandle) {
  const response = host.execute({
    operations: [{ op: 'getParagraphBorders', paragraph: { paragraph } }],
  });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'paragraphBorders')
    throw new Error(`expected borders: ${JSON.stringify(result)}`);
  return result.value.borders;
}

function write(
  host: AutomationHost,
  paragraph: AutomationHandle,
  borders: AutomationParagraphBordersWrite,
  extra: Record<string, unknown> = {}
) {
  return host.execute({
    operations: [
      { op: 'setParagraphFormat', paragraph: { paragraph }, format: { borders, ...extra } },
    ],
  });
}

function only(host: AutomationHost): AutomationHandle {
  return paragraphsOf(host, roots(host).body)[0]!;
}

const NONE = {
  isVisible: false,
  lineStyle: 'None',
  lineWidth: null,
  color: null,
  colorIndex: null,
};

describe('reading paragraph borders', () => {
  test('answers five edges in collection order, between last and inside', () => {
    const host = open(docx(p('plain')));
    const borders = bordersOf(host, only(host));
    expect(borders.map((edge) => edge.edge)).toEqual(['top', 'left', 'bottom', 'right', 'between']);
    expect(borders.map((edge) => edge.inside)).toEqual([false, false, false, false, true]);
    for (const edge of borders) expect(edge).toMatchObject(NONE);
  });

  test('reads the paragraph own border values', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:left w:val="dashed" w:sz="8" w:space="4" w:color="0000FF"/>' +
          '<w:between w:val="dotted" w:sz="16"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const [top, left, bottom, , between] = bordersOf(host, only(host));
    expect(top).toMatchObject(NONE);
    expect(bottom).toMatchObject(NONE);
    expect(left).toMatchObject({
      isVisible: true,
      lineStyle: 'DashLargeGap',
      lineWidth: 'Pt100',
      color: '#0000FF',
      colorIndex: 'Blue',
    });
    // Two points is no `Word.LineWidth` value, and an absent colour is automatic.
    expect(between).toMatchObject({
      isVisible: true,
      lineStyle: 'Dot',
      lineWidth: null,
      color: null,
      colorIndex: 'Auto',
    });
  });

  test('reads a border the style supplies', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const [top, , bottom] = bordersOf(host, only(host));
    expect(top).toMatchObject({
      isVisible: true,
      lineStyle: 'Double',
      lineWidth: 'Pt075',
      color: '#FF0000',
      colorIndex: 'Red',
    });
    expect(bottom).toMatchObject({ isVisible: true, lineStyle: 'Single', lineWidth: 'Pt150' });
  });

  test('the paragraph own element replaces the style element whole', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Ruled"/><w:pBdr><w:left w:val="single"/></w:pBdr></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE
      )
    );
    const [top, left, bottom] = bordersOf(host, only(host));
    expect(top.isVisible).toBe(false);
    expect(bottom.isVisible).toBe(false);
    expect(left.isVisible).toBe(true);
  });

  test('a line style no Office value names reads null, art and thick included', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:top w:val="thick"/><w:bottom w:val="apples" w:sz="24"/></w:pBdr>' +
          '</w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const [top, , bottom] = bordersOf(host, only(host));
    expect(top).toMatchObject({ isVisible: true, lineStyle: null });
    expect(bottom).toMatchObject({ isVisible: true, lineStyle: null, lineWidth: 'Pt300' });
  });
});

describe('writing paragraph borders', () => {
  test('a bottom line with the default width, gap and colour', () => {
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    expect(write(host, paragraph, { bottom: { lineStyle: 'Single' } }).results[0]?.status).toBe(
      'ok'
    );
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:bottom w:color="auto" w:space="1" w:sz="4" w:val="single"/></w:pBdr>'
    );
    expect(bordersOf(host, paragraph)[2]).toMatchObject({
      isVisible: true,
      lineStyle: 'Single',
      lineWidth: 'Pt050',
      colorIndex: 'Auto',
    });
  });

  test('isVisible draws a single line, and side edges take a four point gap', () => {
    const host = open(docx(p('plain')));
    write(host, only(host), { left: { isVisible: true }, right: { isVisible: true } });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:left w:color="auto" w:space="4" w:sz="4" w:val="single"/>');
    expect(xml).toContain('<w:right w:color="auto" w:space="4" w:sz="4" w:val="single"/>');
  });

  test('every Office line style and width writes its OOXML value, and reads back', () => {
    const styles = {
      Single: 'single',
      Dot: 'dotted',
      DashSmallGap: 'dashSmallGap',
      DashLargeGap: 'dashed',
      DashDot: 'dotDash',
      DashDotDot: 'dotDotDash',
      Double: 'double',
      Triple: 'triple',
      ThinThickSmallGap: 'thinThickSmallGap',
      ThickThinSmallGap: 'thickThinSmallGap',
      ThinThickThinSmallGap: 'thinThickThinSmallGap',
      ThinThickMedGap: 'thinThickMediumGap',
      ThickThinMedGap: 'thickThinMediumGap',
      ThinThickThinMedGap: 'thinThickThinMediumGap',
      ThinThickLargeGap: 'thinThickLargeGap',
      ThickThinLargeGap: 'thickThinLargeGap',
      ThinThickThinLargeGap: 'thinThickThinLargeGap',
      SingleWavy: 'wave',
      DoubleWavy: 'doubleWave',
      DashDotStroked: 'dashDotStroked',
      Emboss3D: 'threeDEmboss',
      Engrave3D: 'threeDEngrave',
      Outset: 'outset',
      Inset: 'inset',
    } as const;
    const widths = {
      Pt025: 2,
      Pt050: 4,
      Pt075: 6,
      Pt100: 8,
      Pt150: 12,
      Pt225: 18,
      Pt300: 24,
      Pt450: 36,
      Pt600: 48,
    } as const;
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    const widthNames = Object.keys(widths) as (keyof typeof widths)[];
    Object.entries(styles).forEach(([style, value], index) => {
      const width = widthNames[index % widthNames.length]!;
      const response = write(host, paragraph, {
        top: { lineStyle: style as keyof typeof styles, lineWidth: width },
      });
      expect(response.results[0]?.status).toBe('ok');
      expect(savedMainXml(host)).toContain(`w:sz="${widths[width]}" w:val="${value}"`);
      expect(bordersOf(host, paragraph)[0]).toMatchObject({ lineStyle: style, lineWidth: width });
    });
  });

  test('a colour replaces a theme colour, and colorIndex writes the palette value', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="4472C4" w:themeColor="accent1"' +
          ' w:themeShade="BF"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const paragraph = only(host);
    write(host, paragraph, {
      top: { color: '#00ff00' },
      bottom: { lineStyle: 'Single', colorIndex: 'Teal' },
    });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:top w:color="00FF00" w:sz="4" w:val="single"/>');
    expect(xml).toContain('<w:bottom w:color="008080" w:space="1" w:sz="4" w:val="single"/>');
    write(host, paragraph, { top: { colorIndex: 'Auto' } });
    expect(bordersOf(host, paragraph)[0]).toMatchObject({ color: null, colorIndex: 'Auto' });
  });

  test('turning the only edge off removes the paragraph border', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4"/></w:pBdr></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    write(host, only(host), { bottom: { isVisible: false } });
    expect(savedMainXml(host)).not.toContain('pBdr');
  });

  test('changing one edge of a style border copies the others into the paragraph', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, { bottom: { color: '#0000FF' } });
    const xml = savedMainXml(host);
    expect(xml).toContain(
      '<w:pBdr><w:top w:color="FF0000" w:space="1" w:sz="6" w:val="double"/>' +
        '<w:bottom w:color="0000FF" w:space="1" w:sz="12" w:val="single"/></w:pBdr>'
    );
    const [top, , bottom] = bordersOf(host, paragraph);
    expect(top).toMatchObject({ isVisible: true, lineStyle: 'Double' });
    expect(bottom).toMatchObject({ isVisible: true, color: '#0000FF' });
  });

  test('turning a style edge off writes nil, so no reader shows it', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, { top: { isVisible: false }, bottom: { lineStyle: 'None' } });
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:top w:val="nil"/><w:bottom w:val="nil"/></w:pBdr>'
    );
    for (const edge of bordersOf(host, paragraph)) expect(edge.isVisible).toBe(false);
  });

  test('removing the paragraph own edge keeps a hidden style edge hidden', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Ruled"/><w:pBdr><w:left w:val="single"/></w:pBdr></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE
      )
    );
    const paragraph = only(host);
    write(host, paragraph, { left: { isVisible: false } });
    for (const edge of bordersOf(host, paragraph)) expect(edge.isVisible).toBe(false);
    expect(savedMainXml(host)).toContain('<w:top w:val="nil"/><w:bottom w:val="nil"/>');
  });

  test('writing back what is in force writes nothing, so a style border stays inherited', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    const before = savedMainXml(host);
    const response = write(host, paragraph, {
      top: { isVisible: true, lineStyle: 'Double', lineWidth: 'Pt075', color: '#FF0000' },
      left: { isVisible: false },
    });
    expect(response.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).toBe(before);
  });

  test('a border resolves against the style the same write applies', () => {
    const host = open(docx(p('plain'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, { bottom: { lineWidth: 'Pt300' } }, { style: 'Ruled' });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:pStyle w:val="Ruled"/>');
    expect(xml).toContain('<w:bottom w:color="auto" w:space="1" w:sz="24" w:val="single"/>');
    expect(xml).toContain('<w:top w:color="FF0000" w:space="1" w:sz="6" w:val="double"/>');
  });

  test('borders and other paragraph properties share one write and survive a reopen', () => {
    const host = open(docx(p('plain')));
    const response = write(
      host,
      only(host),
      { top: { lineStyle: 'Triple' } },
      { alignment: 'Centered' }
    );
    expect(response.results[0]?.status).toBe('ok');
    const reopened = reopen(host);
    const paragraph = paragraphsOf(reopened.host, reopened.body)[0]!;
    expect(bordersOf(reopened.host, paragraph)[0]).toMatchObject({ lineStyle: 'Triple' });
    expect(savedMainXml(reopened.host)).toContain('<w:jc w:val="center"/>');
  });

  test('a write keeps w:bar and the attributes the request does not name', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:shadow="1"/>' +
          '<w:bar w:val="single" w:sz="4"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    write(host, only(host), { bottom: { lineWidth: 'Pt225' } });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:bottom w:shadow="1" w:space="6" w:sz="18" w:val="single"/>');
    expect(xml).toContain('<w:bar w:sz="4" w:val="single"/>');
  });

  const refused: readonly [string, unknown][] = [
    ['an edge Office does not address', { bar: { isVisible: true } }],
    ['an unknown edge', { middle: { isVisible: true } }],
    ['an unknown property', { top: { width: 'Pt050' } }],
    ['an unknown line style', { top: { lineStyle: 'Zigzag' } }],
    ['a lower-case line style', { top: { lineStyle: 'single' } }],
    ['an unknown width', { top: { lineStyle: 'Single', lineWidth: 'Pt200' } }],
    ['a colour without a hash', { top: { lineStyle: 'Single', color: 'FF0000' } }],
    ['a colour name', { top: { lineStyle: 'Single', color: 'red' } }],
    [
      'a palette entry this host cannot resolve',
      { top: { lineStyle: 'Single', colorIndex: 'ByAuthor' } },
    ],
    ['both colour forms', { top: { lineStyle: 'Single', color: '#FF0000', colorIndex: 'Red' } }],
    ['a width on an edge with no line', { top: { lineWidth: 'Pt100' } }],
    ['a colour on an edge turned off', { top: { isVisible: false, color: '#FF0000' } }],
    [
      'a visibility that disagrees with the line style',
      { top: { isVisible: false, lineStyle: 'Single' } },
    ],
    ['a visibility that is not a boolean', { top: { isVisible: 'yes' } }],
    ['an edge that is not an object', { top: true }],
    ['borders that are not an object', ['top']],
  ];
  for (const [name, borders] of refused) {
    test(`refuses ${name} and changes nothing`, () => {
      const host = open(docx(p('plain')));
      const before = savedMainXml(host);
      const response = write(host, only(host), borders as AutomationParagraphBordersWrite);
      expect(refusal(response)).toBe('unsupported-content');
      expect(savedMainXml(host)).toBe(before);
    });
  }
});

describe('tracked paragraph borders', () => {
  const TRACK = { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' } as const;

  test('records one paragraph property change that reject reverts', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    const before = savedMainXml(host);
    const response = host.execute({
      operations: [
        TRACK,
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph },
          format: { alignment: 'Right', borders: { bottom: { lineStyle: 'Double' } } },
        },
      ],
    });
    expect(response.results.map((result) => result.status)).toEqual(['ok', 'ok']);
    const xml = savedMainXml(host);
    expect(xml.match(/<w:pPrChange /g)?.length).toBe(1);
    expect(xml).toMatch(
      /<w:pPrChange w:author="Agent"[^>]*><w:pPr><w:pStyle w:val="Ruled"\/><\/w:pPr>/
    );
    host.execute({ operations: [{ op: 'rejectAllRevisions', document: roots(host).document }] });
    expect(savedMainXml(host)).toBe(before);
  });

  test('accept keeps the border and drops the record', () => {
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    host.execute({
      operations: [
        TRACK,
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph },
          format: { borders: { top: { isVisible: true } } },
        },
      ],
    });
    host.execute({ operations: [{ op: 'acceptAllRevisions', document: roots(host).document }] });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:top w:color="auto" w:space="1" w:sz="4" w:val="single"/>');
    expect(xml).not.toContain('pPrChange');
  });
});

describe('locked paragraph borders', () => {
  test('a content lock refuses a border write', () => {
    const host = open(
      docx(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          p('locked') +
          '</w:sdtContent></w:sdt>'
      )
    );
    const before = savedMainXml(host);
    const response = write(host, only(host), { bottom: { lineStyle: 'Single' } });
    expect(response.results[0]?.status).toBe('error');
    expect(savedMainXml(host)).toBe(before);
  });
});
