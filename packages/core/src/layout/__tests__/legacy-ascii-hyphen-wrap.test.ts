import { expect, test } from 'bun:test';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { cjkAutofitBreaks } from '../autofit-unwrapped-text.ts';
import { DEFAULT_CJK_TYPOGRAPHY, type CjkParagraphTypography } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { paragraphMinimumWidthPt } from '../table-autofit-widths.ts';

const settings = {
  strict: false,
  compression: 'compressPunctuation' as const,
  legacyLineEndPunctuation: true as const,
  before: {},
  after: {},
};
const policy = { ...DEFAULT_CJK_TYPOGRAPHY, settings };

function pieces(...texts: string[]): FieldAwarePiece[] {
  let start = 0;
  return texts.map((text) => {
    const piece = { text, start, end: start + text.length, props: [], style: DEFAULT_RUN_STYLE };
    start = piece.end;
    return piece;
  });
}

test.each([
  '甲AB123-2048乙',
  'well-known',
  'かなAB123-2048',
  '甲2026-2048',
  '甲乙-ABCD',
  '甲）-ABCD',
  'ＡＢ-ABCD',
  'ABCD-éfgh',
  'ABCD-Жабв',
  'ABCD-(abc)',
  'ABCD-$123',
  "ABCD-'abc",
])('legacy punctuation compression keeps a hyphen with the text after it in %s', (text) => {
  const runs = pieces(text);
  const cut = text.indexOf('-') + 1;
  const breaks = cjkParagraphBreaks(runs, policy);
  expect(breaks?.boundaries(runs[0]!)).not.toContain(cut);
  expect(breaks?.decision(runs[0]!, cut, '', '')).toBe('continues');
  expect(breaks?.cutAllowed(runs[0]!, 0, cut)).toBe(true);
});

test('formatting seams in a legacy hyphen word do not create break opportunities', () => {
  const runs = pieces('甲AB123', '-', '2048乙');
  const breaks = cjkParagraphBreaks(runs, policy);
  expect(breaks?.decision(runs[1]!, 0, '', '')).toBe('continues');
  expect(breaks?.decision(runs[2]!, 0, '', '')).toBe('continues');
  const widths = cjkAutofitBreaks(runs, { props: [] }, createFixedMeasurer(6, 14), {
    typography: settings,
  });
  expect(widths?.opens(runs[2]!)).toBe(false);
});

test.each(['ABCD-甲乙', 'ABCD-ＡＢ', '甲ABCD- efgh', '甲乙-丙丁'])(
  'a legacy hyphen still breaks before East Asian text or a space in %s',
  (text) => {
    const runs = pieces(text);
    const cut = text.indexOf('-') + 1;
    const breaks = cjkParagraphBreaks(runs, policy);
    expect(breaks?.decision(runs[0]!, cut + (text[cut] === ' ' ? 1 : 0), '', '')).toBe('opens');
  }
);

test('legacy hyphen grouping preserves other dash breaks and explicit character wrapping', () => {
  const runs = pieces('甲AB123-2048 AB123–2048 AB123- 2048');
  const text = runs[0]!.text;
  const hyphen = text.indexOf('-') + 1;
  const enDash = text.indexOf('–') + 1;
  const wrap = (change: CjkParagraphTypography = policy) =>
    cjkParagraphBreaks(runs, change)?.boundaries(runs[0]!);
  expect(wrap()).toContain(enDash);
  expect(wrap()).toContain(text.lastIndexOf(' ') + 1);
  expect(wrap({ ...policy, characterWrap: true })).toContain(hyphen);
  const modernSettings = { ...settings, legacyLineEndPunctuation: undefined };
  expect(wrap({ ...policy, settings: modernSettings })).toContain(hyphen);
  expect(wrap({ ...policy, settings: { ...settings, compression: 'doNotCompress' } })).toContain(
    hyphen
  );
});

test('Korean runs beside East Asian text keep their hyphen breaks; Latin-only Korean runs glue', () => {
  const korean = [{ localName: 'lang', attributes: { eastAsia: 'ko-KR' } }];
  const mixed = pieces('甲乙AB123-2048').map((piece) => ({ ...piece, props: korean }));
  const latin = pieces('well-known words').map((piece) => ({ ...piece, props: korean }));
  expect(cjkParagraphBreaks(mixed, policy)?.boundaries(mixed[0]!)).toContain(8);
  expect(cjkParagraphBreaks(latin, policy)?.decision(latin[0]!, 5, '', '')).toBe('continues');
});

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function root(xml: string) {
  const read = readOoxmlPart(xml, { name: '/word/part.xml', contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part.root;
}
function minimum(body: string, mode: '14' | '15') {
  const cascade = buildStyleCascadeTable(
    null,
    NO_THEME_FONTS,
    root(
      `<w:settings xmlns:w="${NS}"><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat></w:settings>`
    )
  );
  const paragraph = root(
    `<w:document xmlns:w="${NS}"><w:body><w:p>${body}</w:p></w:body></w:document>`
  ).children[0]!;
  if (!('localName' in paragraph) || !('children' in paragraph)) throw Error('body required');
  const p = paragraph.children.find((child) => 'localName' in child && child.localName === 'p');
  if (!p || !('localName' in p)) throw Error('paragraph required');
  return paragraphMinimumWidthPt(p, {
    context: { measurer: createFixedMeasurer(6, 14) },
    view: { styleCascade: cascade, displayMode: 'all-markup', readNested: () => null },
    tableCellStyle: undefined,
  });
}
const run = (text: string, props = '') =>
  `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test.each([
  ['one run', run('aa well-known')],
  ['a run seam after the hyphen', run('aa well-') + run('known')],
  ['a hidden run after the hyphen', run('aa well-') + run('xx', '<w:vanish/>') + run('known')],
])('an autofit table keeps a legacy hyphen word whole across %s', (_, body) => {
  // `well-known` is the widest unit in mode 14; `well-` and `known` are in mode 15.
  expect(minimum(body, '14')).toBeCloseTo(2 * minimum(body, '15'));
  expect(minimum(body, '14')).toBeCloseTo(minimum(run('aa well-known'), '14'));
});
