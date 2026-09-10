import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HYPHENATION_SETTINGS,
  hyphenationSettingsFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type DocumentHyphenationSettings,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { passProducerOf } from '../pass-producer.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import {
  hyphenateMixedToken,
  hyphenateOverflowingCandidate,
  hyphenationSplitForOverflow,
  interiorLetterRuns,
  leadingLetterRun,
  letterWordTail,
  mixedTokenAcrossPieces,
  mixedTokenRunsAreUniform,
  nextOversizedEmptyLineCut,
  type MixedPlaceablePiece,
} from '../paragraph-hyphenation.ts';
import {
  mixedBraceTokenCovering,
  mixedTemplateWrapResume,
} from '../paragraph-hyphenation-stream.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { PendingLine } from '../pending-line.ts';
import { DEFAULT_REVISION_DISPLAY_MODE } from '../revision-projection.ts';
import { linesOf as layoutLinesOf } from '../semantic-record-queries.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const ON: DocumentHyphenationSettings = Object.freeze({
  autoHyphenation: true,
  hyphenationZonePt: 18,
  doNotHyphenateCaps: false,
  consecutiveHyphenLimit: null,
});

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string, extraRPr = '') =>
  `<w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/>${extraRPr}</w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

const ruRun = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

function breakLines(
  body: string,
  width: number,
  settings: DocumentHyphenationSettings = ON,
  extra?: { readonly suppressAutoHyphens?: boolean }
) {
  return breakParagraph(
    paragraph(body),
    'p',
    0,
    width,
    measurer,
    undefined,
    null,
    [],
    undefined,
    undefined,
    undefined,
    {
      hyphenationSettings: settings,
      ...(extra?.suppressAutoHyphens !== undefined
        ? { suppressAutoHyphens: extra.suppressAutoHyphens }
        : {}),
    }
  );
}

const textsOf = (
  body: string,
  width: number,
  settings: DocumentHyphenationSettings = ON,
  extra?: { readonly suppressAutoHyphens?: boolean }
) =>
  breakLines(body, width, settings, extra).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

function hasDiscretionaryHyphen(
  body: string,
  width: number,
  settings: DocumentHyphenationSettings = ON,
  extra?: { readonly suppressAutoHyphens?: boolean }
): boolean {
  return breakLines(body, width, settings, extra).some((line) =>
    line.spans.some((span) => span.discretionaryHyphen)
  );
}

/** After a refused hyphen, a 54pt empty line force-splits the 66pt word. Join the tail. */
const tailText = (texts: readonly string[]) => texts.slice(1).join('');

describe('paragraph-hyphenation helpers', () => {
  test('lookahead stays in letters and stops at the first style span cap', () => {
    expect(leadingLetterRun('citi zenship')).toBe('citi');
    expect(letterWordTail([{ text: 'citi' }, { text: 'zenship more' }], 0, 4)).toBe('zenship');
    expect(letterWordTail([{ text: 'citi', measureText: 'x' }, { text: 'zenship' }], 0, 4)).toBe(
      ''
    );
    expect(letterWordTail([{ text: '{' }, { text: 'd.patient' }], 0, 3)).toBe('patient');
    expect(interiorLetterRuns('{d.patient.documents[0].series}')).toEqual([
      { start: 1, length: 1 },
      { start: 3, length: 7 },
      { start: 11, length: 9 },
      { start: 24, length: 6 },
    ]);
    expect(
      mixedTokenAcrossPieces(
        [{ text: '{' }, { text: 'd.patient' }, { text: '.documents[0].series}' }],
        0,
        0
      )
    ).toBe('{d.patient.documents[0].series}');
  });

  test('a mixed token takes the last interior hyphen that fits', () => {
    const measure = (text: string) => text.length * 6;
    const token = '{d.patient.documents[0].series}';
    const first = hyphenateOverflowingCandidate({
      settings: ON,
      suppressAutoHyphens: false,
      consecutiveHyphenatedLines: 0,
      slackPt: 72,
      language: 'en-US',
      capsFormatted: false,
      measure,
      candidate: token,
      pieces: [{ text: token }],
      pieceIndex: 0,
      consumed: 0,
      layoutOwned: false,
      measureText: undefined,
      ignoreHyphenationZone: true,
    });
    expect(first).toEqual({ utf16Offset: 5, widthPt: 36, hyphenWidthPt: 6 });
    expect(token.slice(0, first!.utf16Offset)).toBe('{d.pa');
    expect(token.includes('\u00AD')).toBe(false);
    const rest = token.slice(first!.utf16Offset);
    const second = hyphenateOverflowingCandidate({
      settings: ON,
      suppressAutoHyphens: false,
      consecutiveHyphenatedLines: 0,
      slackPt: 72,
      language: 'en-US',
      capsFormatted: false,
      measure,
      candidate: rest,
      pieces: [{ text: token }],
      pieceIndex: 0,
      consumed: first!.utf16Offset,
      layoutOwned: false,
      measureText: undefined,
      ignoreHyphenationZone: true,
    });
    expect(second?.utf16Offset).toBe(10);
    expect(rest.slice(0, second!.utf16Offset)).toBe('tient.docu');
  });

  test('a six-run mixed token last-fits a later-run hyphen when styles are uniform', () => {
    const en = [{ localName: 'lang', attributes: { val: 'en-US' } }];
    const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 10 };
    let start = 0;
    const pieces: MixedPlaceablePiece[] = [
      '{',
      'd.patient',
      '.documents',
      '[0',
      '].series',
      '}',
    ].map((text) => {
      const piece = { text, start, props: en, style };
      start += text.length;
      return piece;
    });
    expect(mixedTokenAcrossPieces(pieces, 0, 0)).toBe('{d.patient.documents[0].series}');
    expect(mixedTokenRunsAreUniform(pieces, 0, 0)).toBe(true);
    const measure = (text: string) => text.length * 6;
    const base = {
      settings: ON,
      suppressAutoHyphens: false,
      consecutiveHyphenatedLines: 0,
      language: 'en-US',
      capsFormatted: false,
      measure,
      pieces,
      layoutOwned: false,
      measureText: undefined,
      ignoreHyphenationZone: false,
    };
    const narrow = hyphenateMixedToken({
      ...base,
      candidate: '{',
      slackPt: 66,
      pieceIndex: 0,
      consumed: 0,
    });
    expect(narrow?.hyphen.utf16Offset).toBe(5);
    expect(narrow?.slices.map((slice) => slice.text)).toEqual(['{', 'd.pa']);
    expect(narrow?.nextPieceIndex).toBe(1);
    expect(narrow?.nextConsumed).toBe(4);
    const mixedStyle = pieces.map((piece, index) => ({
      ...piece,
      style: { ...style, fontSizePt: index === 0 ? 10 : 5.5 },
    }));
    expect(mixedTokenRunsAreUniform(mixedStyle, 0, 0)).toBe(false);
    expect(mixedTokenRunsAreUniform(mixedStyle, 1, 0)).toBe(false);
    expect(
      hyphenateMixedToken({
        ...base,
        pieces: mixedStyle,
        candidate: '{',
        slackPt: 66,
        pieceIndex: 0,
        consumed: 0,
      })
    ).toBeNull();
  });

  test('consecutive limit and zone refuse a split', () => {
    const measure = (text: string) => text.length * 6;
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, consecutiveHyphenLimit: 1 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 1,
        slackPt: 30,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })
    ).toBeNull();
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, hyphenationZonePt: 36 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 30,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })
    ).toBeNull();
    expect(
      hyphenationSplitForOverflow({
        settings: ON,
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 30,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })?.utf16Offset
    ).toBe(4);
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, hyphenationZonePt: 36 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 18,
        shrinkBudgetPt: 12,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })
    ).toBeNull();
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, hyphenationZonePt: 18 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 18,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })
    ).toBeNull();
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, hyphenationZonePt: 18 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 18,
        shrinkBudgetPt: 12,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
      })?.utf16Offset
    ).toBe(4);
    expect(
      hyphenationSplitForOverflow({
        settings: { ...ON, hyphenationZonePt: 36 },
        suppressAutoHyphens: false,
        consecutiveHyphenatedLines: 0,
        slackPt: 30,
        word: 'citizenship',
        firstSliceUtf16: 11,
        language: 'en',
        capsFormatted: false,
        measure,
        ignoreHyphenationZone: true,
      })?.utf16Offset
    ).toBe(4);
  });

  test('empty-line cut ignores a hanging trailing space', () => {
    const measure = (text: string) => text.length * 6;
    const hyphen = {
      settings: ON,
      suppressAutoHyphens: false,
      consecutiveHyphenatedLines: 0,
      language: 'en-US' as const,
      capsFormatted: false,
      measure,
      pieces: [{ text: 'citizenship more' }],
      pieceIndex: 0,
      consumed: 0,
      layoutOwned: false,
      measureText: undefined,
    };
    expect(
      nextOversizedEmptyLineCut({
        remaining: 'citizenship ',
        remainingStart: 0,
        availablePt: 70,
        measure,
        hyphen,
        paragraphId: 'p',
        x: 0,
        height: 14,
        props: [],
        style: DEFAULT_RUN_STYLE,
      })
    ).toBeNull();
    expect(
      nextOversizedEmptyLineCut({
        remaining: 'citizenship',
        remainingStart: 0,
        availablePt: 30,
        measure,
        hyphen,
        paragraphId: 'p',
        x: 0,
        height: 14,
        props: [],
        style: DEFAULT_RUN_STYLE,
      })?.span.text
    ).toBe('citi');
  });
});

describe('discretionary hyphen in paragraph flow', () => {
  test('English citizenship splits, keeps source text, and includes hyphen width', () => {
    // "aaa " = 24pt on a 54pt line → slack 30pt, which exceeds an 18pt zone. "citi-" is 30pt.
    const lines = breakLines(`<w:p>${run('aaa citizenship')}</w:p>`, 54);
    expect(textsOf(`<w:p>${run('aaa citizenship')}</w:p>`, 54)).toEqual(['aaa citi', 'zenship']);
    const prefix = lines[0]!.spans[1]!;
    expect(prefix.text).toBe('citi');
    expect(prefix.text.includes('\u00AD')).toBe(false);
    expect(prefix.range).toEqual({ paragraphId: 'p', start: 4, end: 8 });
    expect(prefix.discretionaryHyphen?.widthPt).toBe(6);
    expect(prefix.box.width).toBe(30);
    expect(lines[0]!.width).toBe(54);
    expect(lines[1]!.spans[0]!.text).toBe('zenship');
  });

  test('a uniform mixed template token hyphenates interior letter runs before punctuation', () => {
    const token = '{d.patient.documents[0].series}';
    const body = `<w:p>${run('{')}${run('d.patient')}${run('.documents')}${run('[0')}${run('].series')}${run('}')}</w:p>`;
    const lines = breakLines(body, 72);
    const texts = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts).toEqual(['{d.pa', 'tient.docu', 'ments[0].se', 'ries}']);
    expect(texts.join('')).toBe(token);
    expect(lines[0]!.spans.map((span) => span.range)).toEqual([
      { paragraphId: 'p', start: 0, end: 1 },
      { paragraphId: 'p', start: 1, end: 5 },
    ]);
    expect(lines[0]!.spans[0]!.discretionaryHyphen).toBeUndefined();
    expect(lines[0]!.spans[1]!.discretionaryHyphen?.widthPt).toBe(6);
    expect(lines[0]!.spans[0]!.style.fontSizePt).toBe(lines[0]!.spans[1]!.style.fontSizePt);
    expect(hasDiscretionaryHyphen(body, 72, DEFAULT_HYPHENATION_SETTINGS)).toBe(false);
    expect(textsOf(body, 72, DEFAULT_HYPHENATION_SETTINGS).join('')).toBe(token);
    expect(
      textsOf(`<w:p>${run(token)}</w:p>`, 72, DEFAULT_HYPHENATION_SETTINGS)[0]?.startsWith(
        '{d.patient.d'
      )
    ).toBe(true);
    expect(textsOf(body, 200)).toEqual([token]);
    expect(textsOf(`<w:p>${run('{123}')}</w:p>`, 24)).toEqual(['{', '123}']);
  });

  test('a mixed-style mixed token stream-packs across punctuation without English TeX', () => {
    const token = '{d.patient.documents[0].series}';
    const open =
      `<w:r><w:rPr><w:sz w:val="20"/><w:lang w:val="ru-RU"/></w:rPr>` +
      `<w:t xml:space="preserve">{</w:t></w:r>`;
    const rest =
      `<w:r><w:rPr><w:sz w:val="11"/><w:lang w:val="ru-RU"/></w:rPr>` +
      `<w:t xml:space="preserve">d.patient.documents[0].series}</w:t></w:r>`;
    const body = `<w:p>${open}${rest}</w:p>`;
    const texts = textsOf(body, 72);
    expect(texts.join('')).toBe(token);
    expect(texts[0]).not.toBe('{d.pa');
    expect(texts[0]).not.toBe('{d.patient.');
    expect(texts[0]?.startsWith('{')).toBe(true);
    expect(hasDiscretionaryHyphen(body, 72)).toBe(false);
    expect(textsOf(body, 72, DEFAULT_HYPHENATION_SETTINGS).join('')).toBe(token);
  });

  test('a mixed 10pt brace plus 5.5pt address token keeps source, styles, and Russian hyphens', () => {
    const token = "{d.patient.addresses[addressType='Постоянное место жительства'].house}";
    const open =
      `<w:r><w:rPr><w:sz w:val="20"/><w:lang w:val="ru-RU"/></w:rPr>` +
      `<w:t xml:space="preserve">{</w:t></w:r>`;
    const rest =
      `<w:r><w:rPr><w:sz w:val="11"/><w:lang w:val="ru-RU"/></w:rPr>` +
      `<w:t xml:space="preserve">${token.slice(1)}</w:t></w:r>`;
    const body = `<w:p>${open}${rest}</w:p>`;
    const measurer: TextMeasurer = {
      measure(text, style) {
        let width = 0;
        for (const char of text) {
          const cyrillic = /\p{Script=Cyrillic}/u.test(char);
          width += (style.fontSizePt / 11) * 6 * (cyrillic ? 1.22 : 1);
        }
        return width;
      },
      lineMetrics(style) {
        const height = 14 * (style.fontSizePt / 11);
        return { height, baseline: height * 0.8 };
      },
    };
    const lines = breakParagraph(
      paragraph(body),
      'p',
      0,
      47.5,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      { hyphenationSettings: ON }
    );
    const texts = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts).toEqual([
      '{d.patient.addr',
      'esses[addressTy',
      "pe='Постоян",
      'ное место жи',
      'тель',
      "ства'].house}",
    ]);
    expect(texts.join('')).toBe(token);
    expect(lines[0]!.spans[0]!.style.fontSizePt).toBe(10);
    expect(lines[0]!.spans[0]!.text).toBe('{');
    expect(lines[0]!.spans.slice(1).every((span) => span.style.fontSizePt === 5.5)).toBe(true);
    const ranges = lines.flatMap((line) => line.spans.map((span) => span.range));
    expect(ranges[0]).toEqual({ paragraphId: 'p', start: 0, end: 1 });
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.start).toBe(ranges[index - 1]!.end);
    }
    expect(ranges[ranges.length - 1]!.end).toBe(token.length);
    expect(lines[2]!.spans.at(-1)?.discretionaryHyphen).toBeDefined();
    expect(lines[3]!.spans.at(-1)?.discretionaryHyphen).toBeDefined();
    expect(lines[4]!.spans.at(-1)?.discretionaryHyphen).toBeDefined();
    expect(lines[0]!.spans.every((span) => span.discretionaryHyphen === undefined)).toBe(true);
    expect(textsOf(body, 47.5, DEFAULT_HYPHENATION_SETTINGS).join('')).toBe(token);
  });

  test('a mixed-style address token resumes after a mid-piece Russian hyphen', () => {
    const token = "{d.patient.addresses[addressType='Постоянное место жительства'].house}";
    const sz11 = `<w:rPr><w:sz w:val="11"/><w:lang w:val="ru-RU"/></w:rPr>`;
    const run11 = (text: string) => `<w:r>${sz11}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    const body =
      `<w:p>` +
      `<w:r><w:rPr><w:sz w:val="20"/><w:lang w:val="ru-RU"/></w:rPr>` +
      `<w:t xml:space="preserve">{</w:t></w:r>` +
      run11("d.patient.addresses[addressType='Постоянное ") +
      run11("место жительства'") +
      run11('].') +
      run11('house') +
      run11('}') +
      `</w:p>`;
    const measurer: TextMeasurer = {
      measure(text, style) {
        let width = 0;
        for (const char of text) {
          const cyrillic = /\p{Script=Cyrillic}/u.test(char);
          width += (style.fontSizePt / 11) * 6 * (cyrillic ? 1.22 : 1);
        }
        return width;
      },
      lineMetrics(style) {
        const height = 14 * (style.fontSizePt / 11);
        return { height, baseline: height * 0.8 };
      },
    };
    const lines = breakParagraph(
      paragraph(body),
      'p',
      0,
      47.5,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      { hyphenationSettings: ON }
    );
    const texts = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts).toEqual([
      '{d.patient.addr',
      'esses[addressTy',
      "pe='Постоян",
      'ное место жи',
      'тель',
      "ства'].house}",
    ]);
    expect(texts.join('')).toBe(token);
    const ranges = lines.flatMap((line) => line.spans.map((span) => span.range));
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]!.start).toBe(ranges[index - 1]!.end);
    }
    expect(ranges[ranges.length - 1]!.end).toBe(token.length);
  });

  test('mixedTemplateWrapResume retries a piece when a hyphen stops inside a candidate', () => {
    expect(
      mixedTemplateWrapResume(2, 17, {
        nextPieceIndex: 2,
        nextConsumed: 12,
        fitsFully: false,
      })
    ).toEqual({ consumed: 12, retryAt: 2 });
    expect(
      mixedTemplateWrapResume(2, 17, {
        nextPieceIndex: 2,
        nextConsumed: 17,
        fitsFully: false,
      })
    ).toEqual({ consumed: 17 });
    expect(
      mixedTemplateWrapResume(2, 17, {
        nextPieceIndex: 4,
        nextConsumed: 0,
        fitsFully: true,
      })
    ).toEqual({ consumed: 0, retryAt: 4 });
    expect(mixedBraceTokenCovering([{ text: '{ab}', start: 0 }] as never, 0, 0)).not.toBeNull();
  });

  test('Russian Постоянное splits at a TeX point', () => {
    const lines = breakLines(`<w:p>${ruRun('аа Постоянное')}</w:p>`, 54);
    expect(lines[0]!.spans.some((span) => span.discretionaryHyphen)).toBe(true);
    const joined = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(joined[0]).toContain('По');
    expect(joined.join('')).toContain('стоянное');
    expect(joined.join('')).not.toContain('\u00AD');
  });

  test('inherited w:lang from the cascaded bag admits hyphenation', () => {
    const body =
      `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr>` +
      `<w:t xml:space="preserve">aaa citizenship</w:t></w:r></w:p>`;
    const inherited = [{ localName: 'lang', attributes: { val: 'en-US' } }];
    const texts = breakParagraph(
      paragraph(body),
      'p',
      0,
      54,
      measurer,
      undefined,
      null,
      inherited,
      undefined,
      undefined,
      (base, direct) => [...base, ...direct],
      { hyphenationSettings: ON }
    ).map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts).toEqual(['aaa citi', 'zenship']);
  });

  test('an inherited ru-RU address token does not hyphenate Latin runs', () => {
    const text = "{d.patient.addresses[addressType='Постоянное место жительства'].region}";
    const body =
      `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr>` +
      `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const inherited = [{ localName: 'lang', attributes: { val: 'ru-RU' } }];
    const lines = breakParagraph(
      paragraph(body),
      'p',
      0,
      72,
      measurer,
      undefined,
      null,
      inherited,
      undefined,
      undefined,
      (base, direct) => [...base, ...direct],
      { hyphenationSettings: ON }
    );
    const texts = lines.map((line) => line.spans.map((span) => span.text).join(''));
    expect(texts.join('')).toBe(text);
    expect(texts[0]).not.toBe('{d.pa');
    expect(texts[0]?.startsWith('{d.patient.')).toBe(true);
    expect(lines[0]!.spans.some((span) => span.discretionaryHyphen)).toBe(false);
    expect(texts.some((line) => line.includes('=') || line.includes("'"))).toBe(true);
  });

  test('slack within the zone wraps the whole word', () => {
    const wideZone: DocumentHyphenationSettings = { ...ON, hyphenationZonePt: 36 };
    const body = `<w:p>${run('aaa citizenship')}</w:p>`;
    const lines = breakLines(body, 54, wideZone);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('aaa ');
    expect(lines[0]!.spans.some((span) => span.discretionaryHyphen)).toBe(false);
    expect(tailText(textsOf(body, 54, wideZone))).toBe('citizenship');
    // The wrapped word is still wider than the empty next line, so that line may hyphenate.
    expect(lines.slice(1).some((line) => line.spans.some((span) => span.discretionaryHyphen))).toBe(
      true
    );
  });

  test('justified shrink hyphenates when raw slack is inside the zone', () => {
    // "aa bb cc " = 54pt on 72pt → slack 18pt, equal to the zone. Three spaces shrink 9pt.
    // "cit-" is 24pt and fits 27pt. Left-aligned wrap keeps the whole word.
    const justified = `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('aa bb cc citizenship extra')}</w:p>`;
    const left = `<w:p>${run('aa bb cc citizenship extra')}</w:p>`;
    expect(hasDiscretionaryHyphen(left, 72)).toBe(false);
    expect(textsOf(left, 72)[0]).toBe('aa bb cc ');
    expect(tailText(textsOf(left, 72)).startsWith('citizenship')).toBe(true);
    expect(hasDiscretionaryHyphen(justified, 72)).toBe(true);
    expect(textsOf(justified, 72)[0]).toMatch(/^aa bb cc cit/);
    expect(textsOf(justified, 72).join('')).toBe('aa bb cc citizenship extra');
  });

  test('an empty line does not hyphenate a word that fits once trailing space hangs', () => {
    // "citizenship " = 72pt, visible 66pt, line 70pt. Word hangs the U+0020.
    const body = `<w:p>${run('citizenship more')}</w:p>`;
    expect(hasDiscretionaryHyphen(body, 70)).toBe(false);
    expect(textsOf(body, 70)[0]).toBe('citizenship ');
    expect(tailText(textsOf(body, 70))).toBe('more');
    expect(textsOf(body, 70).join('')).toBe('citizenship more');
  });

  test('unknown language and paragraph suppression fail open', () => {
    const french =
      `<w:p><w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr>` +
      `<w:t xml:space="preserve">aaa citizenship</w:t></w:r></w:p>`;
    expect(textsOf(french, 54)[0]).toBe('aaa ');
    expect(tailText(textsOf(french, 54))).toBe('citizenship');
    expect(hasDiscretionaryHyphen(french, 54)).toBe(false);
    const suppressed = `<w:p>${run('aaa citizenship')}</w:p>`;
    expect(hasDiscretionaryHyphen(suppressed, 54, ON, { suppressAutoHyphens: true })).toBe(false);
    const authored = `<w:p><w:pPr><w:suppressAutoHyphens/></w:pPr>${run('aaa citizenship')}</w:p>`;
    expect(hasDiscretionaryHyphen(authored, 54)).toBe(false);
  });

  test('doNotHyphenateCaps refuses a caps-formatted word', () => {
    const capsOn: DocumentHyphenationSettings = { ...ON, doNotHyphenateCaps: true };
    const capsBody = `<w:p>${run('aaa citizenship', '<w:caps/>')}</w:p>`;
    expect(hasDiscretionaryHyphen(capsBody, 54, capsOn)).toBe(false);
    expect(textsOf(capsBody, 54, capsOn)[0]).toBe('aaa ');
    expect(tailText(textsOf(capsBody, 54, capsOn))).toBe('citizenship');
    expect(textsOf(`<w:p>${run('aaa citizenship')}</w:p>`, 54, capsOn)).toEqual([
      'aaa citi',
      'zenship',
    ]);
  });

  test('a consecutive hyphen limit skips the next overflowing word', () => {
    const limited: DocumentHyphenationSettings = { ...ON, consecutiveHyphenLimit: 1 };
    const lines = breakLines(`<w:p>${run('aaa citizenship bbb citizenship')}</w:p>`, 54, limited);
    const flags = lines.map((line) => line.spans.some((span) => span.discretionaryHyphen));
    expect(flags.some(Boolean)).toBe(true);
    for (let index = 1; index < flags.length; index += 1) {
      expect(flags[index] && flags[index - 1]).toBe(false);
    }
  });

  test('a multi-run word may split only inside the first style span', () => {
    const allowed = `<w:p>${run('aaa ')}${run('citizen')}${run('ship')}</w:p>`;
    const allowedLines = breakLines(allowed, 54);
    expect(allowedLines[0]!.spans.map((span) => span.text).join('')).toBe('aaa citi');
    expect(allowedLines[0]!.spans.some((span) => span.discretionaryHyphen)).toBe(true);
    expect(
      allowedLines
        .slice(1)
        .map((line) => line.spans.map((span) => span.text).join(''))
        .join('')
    ).toBe('zenship');

    const blocked = `<w:p>${run('aaaaaaa ')}${run('ci')}${run('tizenship')}</w:p>`;
    expect(hasDiscretionaryHyphen(blocked, 54)).toBe(false);
    expect(textsOf(blocked, 54)[0]).toBe('aaaaaaa ');
    expect(tailText(textsOf(blocked, 54))).toBe('citizenship');
  });

  test('a glued multi-style word hyphenates inside the current run when the token overflows', () => {
    const body = `<w:p>${run('aa ')}${run('citize')}${run('nship')}</w:p>`;
    expect(textsOf(body, 60)).toEqual(['aa citi', 'zenship']);
    expect(hasDiscretionaryHyphen(body, 60)).toBe(true);
  });

  test('serialization keeps the model word and never writes U+00AD', () => {
    const xml = `<w:document xmlns:w="${W}"><w:body><w:p>${run('aaa citizenship')}</w:p></w:body></w:document>`;
    const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!loaded.ok) throw new Error(loaded.reason);
    const para = loaded.part.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    )!;
    breakParagraph(
      para,
      'p',
      0,
      54,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      {
        hyphenationSettings: ON,
      }
    );
    const saved = serializeOoxmlPart(loaded.part);
    expect(saved).toContain('aaa citizenship');
    expect(saved).not.toContain('\u00AD');
    expect(saved).not.toContain('citi-');
  });

  test('an oversized English word on an empty narrow line takes a visible hyphen', () => {
    // 30pt cell, Word's 18pt zone: full-line slack exceeds the zone, but the word cannot wrap.
    const narrow: DocumentHyphenationSettings = { ...ON, hyphenationZonePt: 18 };
    const body = `<w:p>${run('citizenship')}</w:p>`;
    const lines = breakLines(body, 30, narrow);
    const prefix = lines[0]!.spans[0]!;
    expect(prefix.text).toBe('citi');
    expect(prefix.text.includes('\u00AD')).toBe(false);
    expect(prefix.range).toEqual({ paragraphId: 'p', start: 0, end: 4 });
    expect(prefix.discretionaryHyphen?.widthPt).toBe(6);
    expect(prefix.box.width).toBe(30);
    expect(lines.map((line) => line.spans.map((span) => span.text).join('')).join('')).toBe(
      'citizenship'
    );
    const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
    const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!loaded.ok) throw new Error(loaded.reason);
    breakParagraph(
      loaded.part.root.children[0]!.children.find((child) => child.kind === 'paragraph')!,
      'p',
      0,
      30,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      { hyphenationSettings: narrow }
    );
    const saved = serializeOoxmlPart(loaded.part);
    expect(saved).toContain('citizenship');
    expect(saved).not.toContain('\u00AD');
  });

  test('an oversized Russian word on an empty narrow line takes a visible hyphen', () => {
    const narrow: DocumentHyphenationSettings = { ...ON, hyphenationZonePt: 18 };
    const body = `<w:p>${ruRun('Постоянное')}</w:p>`;
    const lines = breakLines(body, 30, narrow);
    const prefix = lines[0]!.spans[0]!;
    expect(prefix.text).toBe('По');
    expect(prefix.discretionaryHyphen?.widthPt).toBe(6);
    expect(prefix.box.width).toBe(18);
    expect(lines.map((line) => line.spans.map((span) => span.text).join('')).join('')).toBe(
      'Постоянное'
    );
    expect(prefix.text.includes('\u00AD')).toBe(false);
  });

  test('autoHyphenation off still emergency-splits an oversized empty-line word', () => {
    const body = `<w:p>${run('citizenship')}</w:p>`;
    const lines = breakLines(body, 30, DEFAULT_HYPHENATION_SETTINGS);
    expect(lines.some((line) => line.spans.some((span) => span.discretionaryHyphen))).toBe(false);
    expect(textsOf(body, 30, DEFAULT_HYPHENATION_SETTINGS)).toEqual(['citiz', 'enshi', 'p']);
    expect(lines[0]!.spans[0]!.range).toEqual({ paragraphId: 'p', start: 0, end: 5 });
  });
});

describe('hyphenation cache identity', () => {
  test('the pass producer folds the hyphenation fingerprint', () => {
    const off = passProducerOf(
      'base',
      undefined,
      undefined,
      undefined,
      DEFAULT_REVISION_DISPLAY_MODE,
      undefined,
      undefined,
      hyphenationSettingsFingerprint(DEFAULT_HYPHENATION_SETTINGS)
    );
    const on = passProducerOf(
      'base',
      undefined,
      undefined,
      undefined,
      DEFAULT_REVISION_DISPLAY_MODE,
      undefined,
      undefined,
      hyphenationSettingsFingerprint(ON)
    );
    expect(off).toContain('hyph:off');
    expect(on).toContain(hyphenationSettingsFingerprint(ON));
    expect(off).not.toBe(on);
  });

  test('a settings-only change misses the paragraph cache', () => {
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const loaded = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>${run('aaa citizenship')}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    const geometry = {
      width: 74,
      height: 200,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const off = layoutSemanticDocument(loaded.part, 1, {
      measurer,
      cache,
      producer: 'hyph-cache',
      geometry,
      hyphenationSettings: DEFAULT_HYPHENATION_SETTINGS,
    });
    const missesAfterOff = cache.stats.misses;
    const on = layoutSemanticDocument(loaded.part, 1, {
      measurer,
      cache,
      producer: 'hyph-cache',
      geometry,
      hyphenationSettings: ON,
    });
    expect(cache.stats.misses).toBeGreaterThan(missesAfterOff);
    const text = (layout: typeof off) =>
      layoutLinesOf(layout).map((line) => line.spans.map((span) => span.text).join(''));
    expect(text(off)[0]).toBe('aaa ');
    expect(text(off).slice(1).join('')).toBe('citizenship');
    expect(
      layoutLinesOf(off).some((line) => line.spans.some((span) => span.discretionaryHyphen))
    ).toBe(false);
    expect(text(on)).toEqual(['aaa citi', 'zenship']);
    expect(
      layoutLinesOf(on).some((line) => line.spans.some((span) => span.discretionaryHyphen))
    ).toBe(true);
  });
});
