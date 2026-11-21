import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createLayoutSession } from '../layout-session.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';
import { fittingClusters } from '../cjk-optical-fit.ts';
import { segmentGraphemes } from '../grapheme.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const outline =
  '<w14:textOutline xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:w="12700"><w14:solidFill><w14:srgbClr w14:val="FF0000"/></w14:solidFill></w14:textOutline>';
// A shifted glyph paints transparent text, which would drop these decorations.
const paintRefused = ['<w:u w:val="single"/>', '<w:strike/>', '<w:dstrike/>', outline];
const bounds: Record<string, [number, number]> = {
  '（': [0.662, 0.899],
  '）': [0.135, 0.372],
  '：': [0.193, 0.305],
  '【': [0.579, 0.92],
  '】': [0.08, 0.421],
  '、': [0.099, 0.324],
  '。': [0.08, 0.34],
};
// Songti SC native advances and outline bounds. Font files are not required by this oracle.
const measurer: TextMeasurer = {
  measure(text, style) {
    return (
      ([...text].reduce((sum, c) => sum + (c === ' ' ? 0.25 : 1), 0) *
        style.fontSizePt *
        style.horizontalScalePercent) /
        100 +
      text.length * style.characterSpacingPt
    );
  },
  inkBounds(text, style) {
    const [left, right] = bounds[text] ?? [0.05, 0.95];
    const em = (style.fontSizePt * style.horizontalScalePercent) / 100;
    return { left: left * em, right: right * em };
  },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};
function part(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
// No declared compatibility mode (`w:compatSetting` `compatibilityMode`): a legacy mode.
const settings = part(
  `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`
);
function layout(
  text: string,
  width: number,
  split = text.length,
  measure = measurer,
  runProps = '',
  // Optical fitting needs an East Asian face in the document defaults; every probe names one.
  sourcePolicy: {
    readonly eastAsianDefaults?: boolean;
    readonly kern?: number;
    /**
     * `w:compatSetting` `compatibilityMode`; absent declares mode 15, and `null` declares none,
     * a legacy mode with the half-advance admission limit.
     */
    readonly mode?: number | null;
    /** East Asian language of the document defaults. */
    readonly lang?: string;
    /** Extra paragraph properties. */
    readonly pPr?: string;
    /** Extra run properties of the first run only. */
    readonly firstRunProps?: string;
    /** `w:overflowPunct`; off unless set. */
    readonly overflowPunct?: boolean;
  } = {
    eastAsianDefaults: true,
  },
  jc = 'both',
  overflowPunctuation = false
) {
  const run = (value: string, extra = '') =>
    `<w:r><w:rPr><w:sz w:val="24"/>${sourcePolicy?.kern === undefined ? '' : `<w:kern w:val="${sourcePolicy.kern}"/>`}${runProps}${extra}</w:rPr><w:t xml:space="preserve">${value}</w:t></w:r>`;
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${sourcePolicy?.pPr ?? ''}<w:jc w:val="${jc}"/><w:overflowPunct w:val="${(sourcePolicy?.overflowPunct ?? overflowPunctuation) ? 1 : 0}"/></w:pPr>${split === -1 ? [...text].map((value) => run(value)).join('') : run(text.slice(0, split), sourcePolicy?.firstRunProps) + run(text.slice(split))}</w:p></w:body></w:document>`
  );
  return linesOf(
    layoutSemanticDocument(source, 0, {
      measurer: measure,
      styleCascade: buildStyleCascadeTable(
        sourcePolicy?.eastAsianDefaults
          ? part(
              `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/>${sourcePolicy.lang ? `<w:lang w:eastAsia="${sourcePolicy.lang}"/>` : ''}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
            ).root
          : null,
        // The font table gives the probe face an East Asian charset.
        { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
        sourcePolicy?.mode === null
          ? settings.root
          : part(
              `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${sourcePolicy?.mode ?? 15}"/></w:compat></w:settings>`
            ).root
      ),
      geometry: {
        width: width + 20,
        height: 500,
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
      },
    })
  );
}
// Positive pair vectors explicitly author EA defaults and kern on both real runs.
const qualifiedLayout = (
  text: string,
  width: number,
  split = text.length,
  measure = measurer,
  runProps = '',
  jc = 'both'
) => layout(text, width, split, measure, runProps, { eastAsianDefaults: true, kern: 2 }, jc);
// Three independent width/group experiments, Songti SC 12 pt. The source alignment was not
// recorded. Fitting vectors run justified; the 88 pt vector runs left-aligned to keep its
// natural origins on a wrapped line.
const word: { text: string; width: number; lines: string[]; origins: number[]; jc?: string }[] = [
  {
    text: '甲乙（丙丁）戊己',
    width: 90,
    lines: ['甲乙（丙丁）戊己'],
    origins: [0, 12, 21, 33, 45, 57, 66, 78],
  },
  {
    text: '甲乙（丙丁）戊己',
    width: 88,
    jc: 'left',
    lines: ['甲乙（丙丁）戊', '己'],
    origins: [0, 12, 24, 36, 48, 60, 72],
  },
  {
    text: '甲乙（丙丁戊己',
    width: 78,
    lines: ['甲乙（丙丁戊己'],
    origins: [0, 12, 18, 30, 42, 54, 66],
  },
  {
    text: '甲乙（丙丁）戊己。',
    width: 90,
    lines: ['甲乙（丙丁）戊己。'],
    origins: [0, 12, 18, 30, 42, 54, 60, 72, 84],
  },
  {
    text: '甲乙丙丁、戊己',
    width: 54,
    lines: ['甲乙丙丁、', '戊己'],
    origins: [0, 12, 24, 36, 48],
  },
  {
    text: '原合同（出租方）：【    】（（甲））、乙',
    width: 120,
    lines: ['原合同（出租方）：【    】', '（（甲））、乙'],
    origins: [0, 12, 24, 33, 45, 57, 69, 81, 87, 90, 102, 105, 108, 111, 114],
  },
  {
    text: '甲乙丙丁（（甲））、乙）：【    】',
    width: 96,
    lines: ['甲乙丙丁（（甲））、', '乙）：【    】'],
    origins: [0, 12, 24, 36, 48, 54, 66, 78, 84, 90],
  },
  {
    text: '甲乙（（甲））、乙）：【    】',
    width: 120,
    lines: ['甲乙（（甲））、乙）：【    】'],
    origins: [0, 12, 20, 26, 38, 50, 56, 62, 70, 82, 88, 90, 102, 105, 108, 111, 114],
  },
];
for (const fixture of word)
  test(`Word optical fit at ${fixture.width}${fixture.jc ? ` (${fixture.jc})` : ''}: ${fixture.text}`, () => {
    const lines = qualifiedLayout(
      fixture.text,
      fixture.width,
      undefined,
      undefined,
      '',
      fixture.jc
    );
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual(
      fixture.lines
    );
    const origins = lines[0]!.spans.flatMap((span) =>
      [...span.text].map(
        (_, offset) =>
          span.box.x +
          measurer.measure(span.text.slice(0, offset), span.style) +
          (span.glyphOffsetPt ?? 0)
      )
    );
    expect(origins.length).toBe(fixture.origins.length);
    origins.forEach((value, index) => expect(value).toBeCloseTo(fixture.origins[index]!, 3));
  });

test('optical Word vectors survive each source-run seam', () => {
  for (const fixture of word) {
    for (let split = 0; split <= fixture.text.length; split++) {
      const lines = qualifiedLayout(fixture.text, fixture.width, split, undefined, '', fixture.jc);
      expect({
        text: fixture.text,
        split,
        lines: lines.map((line) => line.spans.map((span) => span.text).join('')),
      }).toEqual({ text: fixture.text, split, lines: fixture.lines });
      const origins = lines[0]!.spans.flatMap((span) =>
        [...span.text].map(
          (_, offset) =>
            span.box.x +
            measurer.measure(span.text.slice(0, offset), span.style) +
            (span.glyphOffsetPt ?? 0)
        )
      );
      origins.forEach((value, index) => expect(value).toBeCloseTo(fixture.origins[index]!, 3));
    }
  }
});

test('unknown and non-finite bounds retain natural line fitting', () => {
  for (const inkBounds of [undefined, () => undefined, () => ({ left: NaN, right: 6 })]) {
    const lines = layout('甲乙（丙丁）戊己', 90, undefined, { ...measurer, inkBounds });
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲乙（丙丁）戊',
      '己',
    ]);
  }
});

test('optical fitting retains underlined, struck, outlined and revised glyph geometry', () => {
  for (const props of [
    ...paintRefused,
    '<w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange>',
  ]) {
    const lines = layout('甲乙（丙丁）戊己', 90, undefined, measurer, props);
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '甲乙（丙丁）戊',
      '己',
    ]);
    expect(
      lines.flatMap((line) => line.spans).every((span) => span.glyphOffsetPt === undefined)
    ).toBe(true);
  }
});

test('optical fitting never borrows unavailable ink bearings', () => {
  const noBearings: TextMeasurer = {
    ...measurer,
    inkBounds: (text, style) => ({
      left: 0,
      right: measurer.measure(text, { ...style, characterSpacingPt: 0 }),
    }),
  };
  for (const fixture of word) {
    const lines = layout(fixture.text, fixture.width, undefined, noBearings);
    for (const line of lines) {
      for (const span of line.spans) {
        // Shared-seam compression remains the established advance-only policy.
        // Optical fitting cannot create any further reduction when ink fills the advance.
        expect(span.style.characterSpacingPt === 0 || span.style.characterSpacingPt === -6).toBe(
          true
        );
      }
    }
  }
});

test('repeated optical fits remain independent of source-run boundaries', () => {
  for (const text of [
    '甲（乙）丙、丁：【  】戊己。',
    '甲乙（丙丁）戊己。甲乙（丙丁）戊己。',
    '甲乙（（甲））、乙）：【    】甲乙',
  ]) {
    for (const width of [54, 78, 90, 120]) {
      const geometry = (split: number) =>
        layout(text, width, split).map((line) => ({
          text: line.spans.map((span) => span.text).join(''),
          origins: line.spans.flatMap((span) =>
            [...span.text].map((_, offset) =>
              Math.round(
                (span.box.x +
                  measurer.measure(span.text.slice(0, offset), span.style) +
                  (span.glyphOffsetPt ?? 0)) *
                  1000
              )
            )
          ),
        }));
      const expected = geometry(text.length);
      for (let split = 0; split <= text.length; split++)
        expect({ text, width, split, geometry: geometry(split) }).toEqual({
          text,
          width,
          split,
          geometry: expected,
        });
    }
  }
});

function geometry(lines: ReturnType<typeof layout>) {
  return lines.map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    origins: line.spans.flatMap((span) =>
      [...span.text].map((_, offset) =>
        Math.round(
          (span.box.x +
            measurer.measure(span.text.slice(0, offset), span.style) +
            (span.glyphOffsetPt ?? 0)) *
            1000
        )
      )
    ),
  }));
}

test('protected and trailing spaces preserve source-run-independent optical geometry', () => {
  for (const [text, width, props] of [
    ['甲丙、乙、戊）：丁）丙。 。', 75, ''],
    ['丁。】甲】）丁（  ', 73, ''],
    ['： 乙【： 】甲戊）乙 】【  】。 、丁） （  】甲', 135, ''],
    ['丁【乙（】）戊。：（ 。丙。】、丙（丙 ： 丁（：、', 37, ''],
    ['乙甲：、 ', 37, '<w:spacing w:val="30"/>'],
    [
      '乙（丁（】【 、乙【乙【丁（：）：【丁。：【戊（ （丙）戊） 、丙、',
      79,
      '<w:spacing w:val="30"/>',
    ],
  ] as const) {
    const expected = geometry(layout(text, width, undefined, measurer, props));
    for (let split = -1; split <= text.length; split++)
      expect(geometry(layout(text, width, split, measurer, props))).toEqual(expected);
  }
});

test('Word colon/closing compression includes authored tracking at wide and narrow measures', () => {
  // Controls: Songti SC12pt, w:spacing=0/30, measures37/200pt.
  const text = '甲：、 ';
  for (const width of [37, 200])
    for (const spacing of [0, 30])
      for (let split = -1; split <= text.length; split++) {
        const lines = qualifiedLayout(
          text,
          width,
          split,
          measurer,
          `<w:spacing w:val="${spacing}"/>`
        );
        expect(geometry(lines)).toEqual([
          { text, origins: spacing ? [0, 13500, 20250, 33750] : [0, 12000, 18000, 30000] },
        ]);
      }
});

test('Word compresses the colon before closing classes with left and centered colon ink', () => {
  // Hiragino Mincho ProN W3 outline x bounds, independently read in 1000-unit font space.
  const hiraginoBounds: Record<string, [number, number]> = {
    '：': [0.429, 0.57],
    '、': [0.059, 0.314],
    '。': [0.059, 0.317],
    '）': [0.067, 0.314],
    '】': [0.066, 0.35],
    '』': [0.067, 0.394],
    '，': [0.059, 0.203],
  };
  const hiragino: TextMeasurer = {
    ...measurer,
    inkBounds(text, style) {
      const [left, right] = hiraginoBounds[text] ?? [0.05, 0.95];
      const em = (style.fontSizePt * style.horizontalScalePercent) / 100;
      return { left: left * em, right: right * em };
    },
  };
  for (const measure of [measurer, hiragino])
    for (const closing of '、。）】』，') {
      const text = `甲：${closing}乙`;
      for (let split = -1; split <= text.length; split++)
        expect(geometry(qualifiedLayout(text, 200, split, measure))).toEqual([
          { text, origins: [0, 12000, 18000, 30000] },
        ]);
    }
});

test('unqualified punctuation pairs keep natural advances', () => {
  for (const sourcePolicy of [
    undefined,
    { kern: 2 },
    { eastAsianDefaults: true },
    { eastAsianDefaults: true, kern: 0 },
    { eastAsianDefaults: true, kern: 60 },
  ])
    for (let split = -1; split <= 4; split++)
      expect(geometry(layout('甲：、乙', 200, split, measurer, '', sourcePolicy))).toEqual([
        { text: '甲：、乙', origins: [0, 12000, 24000, 36000] },
      ]);
});

test('colon/closing pairs retain natural advances without safe measured pair bounds', () => {
  for (const inkBounds of [
    undefined,
    () => undefined,
    () => ({ left: NaN, right: 6 }),
    () => ({ left: -1, right: 6 }),
    () => ({ left: 0, right: 14 }),
  ])
    expect(geometry(layout('甲：、乙', 200, undefined, { ...measurer, inkBounds }))).toEqual([
      { text: '甲：、乙', origins: [0, 12000, 24000, 36000] },
    ]);
});

test('underlined, outlined and revised paragraphs retain the advance-only whitespace path', () => {
  const text = '甲丙、乙、戊）：丁）丙。 。';
  for (const props of [
    '<w:u w:val="single"/>',
    outline,
    '<w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange>',
  ]) {
    for (const split of [-1, text.length])
      expect(geometry(layout(text, 75, split, measurer, props))).toEqual(
        geometry(layout(text, 75, split, { ...measurer, inkBounds: undefined }, props))
      );
  }
});

test('optical line geometry remains stable through cached width changes', () => {
  const text = '甲乙（丙丁）戊己';
  const source = part(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  const session = createLayoutSession();
  const styleCascade = buildStyleCascadeTable(null, undefined, settings.root);
  const draw = (width: number) =>
    geometry(
      linesOf(
        layoutSemanticDocument(source, 0, {
          measurer,
          session,
          styleCascade,
          geometry: {
            width: width + 20,
            height: 500,
            margin: { top: 10, bottom: 10, left: 10, right: 10 },
          },
        })
      )
    );
  const compressed = draw(90);
  expect(draw(90)).toEqual(compressed);
  expect(draw(120)[0]!.origins).toEqual([0, 12000, 24000, 36000, 48000, 60000, 72000, 84000]);
  expect(draw(90)).toEqual(compressed);
});

test('the single-unit cluster fast path agrees with grapheme segmentation', () => {
  const units: string[] = [' ', '\u2018', '\u2019', '\u201c', '\u201d'];
  for (const [from, to] of [
    [0x3000, 0x9fff],
    [0xff00, 0xffef],
  ] as const)
    for (let code = from; code <= to; code += 1) units.push(String.fromCharCode(code));
  let fast = 0;
  for (const unit of units) {
    const text = `甲${unit}${unit}乙`;
    const clusters = fittingClusters(text);
    expect(clusters).toEqual(segmentGraphemes(text));
    if (clusters.length === 4) fast += 1;
  }
  // Combining kana, tone marks, and halfwidth voiced marks take the segmenter path.
  const voiced = 'か' + String.fromCharCode(0x3099);
  expect(fittingClusters(voiced)).toEqual(segmentGraphemes(voiced));
  expect(fittingClusters(voiced)).toHaveLength(1);
  expect(fast).toBeGreaterThan(20_000);
});

const linesAt = (
  jc: string,
  mode?: number | null,
  lang?: string,
  text = '甲乙（丙丁）戊己',
  width = 90
) =>
  layout(
    text,
    width,
    text.length,
    measurer,
    '',
    { eastAsianDefaults: true, kern: 2, mode, lang },
    jc
  ).map((line) => line.spans.map((span) => span.text).join(''));

test('compatibility mode 15 compresses punctuation to fit only justified lines', () => {
  expect(linesAt('both', 15)).toEqual(['甲乙（丙丁）戊己']);
  expect(linesAt('distribute', 15)).toEqual(['甲乙（丙丁）戊己']);
  for (const jc of ['left', 'center', 'right', 'start', 'end'])
    expect(linesAt(jc, 15)).toEqual(['甲乙（丙丁）戊', '己']);
});

test('a legacy mode compresses punctuation to fit lines at every alignment', () => {
  for (const mode of [null, 11, 12, 14])
    for (const jc of ['both', 'left', 'center', 'right', 'start', 'end'])
      for (const lang of [undefined, 'zh-CN', 'zh-TW', 'ja-JP'])
        expect({ mode, jc, lang, lines: linesAt(jc, mode, lang) }).toEqual({
          mode,
          jc,
          lang,
          lines: ['甲乙（丙丁）戊己'],
        });
});

test('a legacy mode compresses no Korean text to fit a line', () => {
  for (const jc of ['both', 'left'])
    expect(linesAt(jc, 14, 'ko-KR')).toEqual(['甲乙（丙丁）戊', '己']);
  // A Korean run anywhere in the candidate group `丁）` refuses the fit, not only its last run.
  const korean = '<w:lang w:eastAsia="ko-KR"/>';
  const first = (firstRunProps: string) =>
    layout(
      '甲。乙，丁）戊己',
      59,
      5,
      measurer,
      '',
      { eastAsianDefaults: true, kern: 2, mode: 14, firstRunProps },
      'left'
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  expect(first('')).toBe('甲。乙，丁）');
  expect(first(korean)).toBe('甲。乙，');
  // Hangul does not fit in a legacy mode, whatever its language tag.
  for (const lang of [undefined, 'zh-CN'])
    expect(linesAt('left', 14, lang, '가나（다라）마바')).toEqual(['가나（다라）', '마바']);
});

test('a legacy mode fits right-to-left paragraphs at both edges', () => {
  const policy = { eastAsianDefaults: true, kern: 2, mode: null, pPr: '<w:bidi/>' };
  for (const jc of ['left', 'right'])
    expect(
      layout('甲乙（丙丁）戊己', 90, 8, measurer, '', policy, jc).map((line) =>
        line.spans.map((span) => span.text).join('')
      )
    ).toEqual(['甲乙（丙丁）戊己']);
});

test('a document whose defaults name no East Asian face compresses no punctuation to fit', () => {
  const text = (eastAsianDefaults: boolean) =>
    layout('甲乙（丙丁）戊己', 90, undefined, measurer, '', { eastAsianDefaults }).map((line) =>
      line.spans.map((span) => span.text).join('')
    );
  expect(text(true)).toEqual(['甲乙（丙丁）戊己']);
  expect(text(false)).toEqual(['甲乙（丙丁）戊', '己']);
});

test('a legacy mode admits an ideograph only within half its advance at every alignment', () => {
  // Two blank sides could give 丙 more than its 6 pt half; a legacy line takes no more.
  const text = '甲。乙，丙丁戊';
  for (const mode of [null, 11, 12, 14])
    for (const jc of ['left', 'center', 'right', 'both']) {
      expect(linesAt(jc, mode, undefined, text, 54)[0]).toBe('甲。乙，丙');
      expect(linesAt(jc, mode, undefined, text, 53.9)[0]).toBe('甲。乙，');
    }
  // Compatibility mode 15 admits it by the expansion gate alone.
  expect(linesAt('both', 15, undefined, text, 53.9)[0]).toBe('甲。乙，丙');
});

test('spaces before a word that wraps do not compress the line', () => {
  // Mixed-script lines qualify each face locally.
  const resolved: TextMeasurer = { ...measurer, hasResolvedFont: () => true };
  for (const [mode, jc] of [
    [14, 'left'],
    [14, 'center'],
    [15, 'both'],
  ] as const) {
    const lines = layout(
      '甲乙丙、丁 word',
      62,
      5,
      resolved,
      '',
      { eastAsianDefaults: true, kern: 2, mode },
      jc
    );
    expect(
      lines.map((line) =>
        line.spans
          .map((span) => span.text)
          .join('')
          .trimEnd()
      )
    ).toEqual(['甲乙丙、丁', 'word']);
    // Every glyph keeps its natural advance; the space trails the line.
    const glyphs = lines[0]!.spans.filter((span) => span.text.trim());
    expect({ mode, jc, width: glyphs.reduce((sum, span) => sum + span.box.width, 0) }).toEqual({
      mode,
      jc,
      width: 60,
    });
  }
});

test('a legacy group of a Latin word and a final mark admits at most half its advance', () => {
  // `ab。` is 36 pt and its final mark drops 6 pt; four marks before it could give 24 pt more.
  const resolved: TextMeasurer = { ...measurer, hasResolvedFont: () => true };
  const first = (mode: number, jc: string, width: number) =>
    layout(
      '甲、乙、丙、丁、戊ab。己',
      width,
      9,
      resolved,
      '',
      { eastAsianDefaults: true, kern: 2, mode },
      jc
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  for (const jc of ['left', 'center', 'right', 'both']) {
    expect(first(14, jc, 123)).toBe('甲、乙、丙、丁、戊ab。');
    expect(first(14, jc, 122)).toBe('甲、乙、丙、丁、戊');
  }
  expect(first(15, 'both', 117)).toBe('甲、乙、丙、丁、戊ab。');
});

test('a legacy group that ends in a Latin closing quote admits at most half its advance', () => {
  // `ab”` counts as a group with a final closing mark: the quote gives its trailing half.
  const resolved: TextMeasurer = { ...measurer, hasResolvedFont: () => true };
  const first = (width: number, mode = 14, jc = 'left') =>
    layout(
      '甲、乙、丙、丁、戊、己、庚ab”辛',
      width,
      13,
      resolved,
      '',
      { eastAsianDefaults: true, kern: 2, mode },
      jc
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  // 195 pt natural; six marks could give 36 pt, the group admits 24 pt.
  expect(first(171)).toBe('甲、乙、丙、丁、戊、己、庚ab”');
  expect(first(170)).toBe('甲、乙、丙、丁、戊、己、庚');
  expect(first(170, 14, 'both')).toBe('甲、乙、丙、丁、戊、己、庚');
  // Compatibility mode 15 has no such limit on a justified line.
  expect(first(170, 15, 'both')).toBe('甲、乙、丙、丁、戊、己、庚ab”');
});

test('a legacy mode compresses no Korean mark to fit a line', () => {
  const korean = '<w:lang w:eastAsia="ko-KR"/>';
  const first = (text: string, split: number, firstRunProps = '', mode = 14, jc = 'left') =>
    layout(
      text,
      70,
      split,
      measurer,
      '',
      { eastAsianDefaults: true, kern: 2, mode, firstRunProps },
      jc
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  // `丁` needs 2 pt from the marks of the first run.
  expect(first('甲、乙、丙丁戊', 4)).toBe('甲、乙、丙丁');
  // A Korean mark, by language or after Hangul, keeps its advance.
  expect(first('甲、乙、丙丁戊', 4, korean)).toBe('甲、乙、丙');
  expect(first('가、나、丙丁戊', 4)).toBe('가、나、丙');
  expect(first('가、나、丙丁戊', 4, '', 14, 'both')).toBe('가、나、丙');
  // Compatibility mode 15 compresses Korean marks on a justified line.
  expect(first('甲、乙、丙丁戊', 4, korean, 15, 'both')).toBe('甲、乙、丙丁');
  // Hangul after the marks does not stop them.
  expect(first('甲、乙、가丁戊', 4)).toBe('甲、乙、가丁');
});

test('a legacy final mark whose ink passes its middle gives only its blank trailing side', () => {
  // `。` ends at 0.8 em, so it gives 2.4 pt and `丁。` may take 14.4 pt in all, not 18 pt.
  const inked: TextMeasurer = {
    ...measurer,
    inkBounds: (text, style) =>
      text === '。'
        ? { left: 0.08 * style.fontSizePt, right: 0.8 * style.fontSizePt }
        : measurer.inkBounds!(text, style),
  };
  const first = (width: number) =>
    layout(
      '甲、乙、丙、丁。戊',
      width,
      8,
      inked,
      '',
      { eastAsianDefaults: true, kern: 2, mode: 14 },
      'left'
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  expect(first(81.6)).toBe('甲、乙、丙、丁。');
  expect(first(81.5)).toBe('甲、乙、丙、');
  // With its ink inside the middle, the same group takes 18 pt.
  expect(linesAt('left', 14, undefined, '甲、乙、丙、丁。戊', 78)[0]).toBe('甲、乙、丙、丁。');
});

test('a legacy hanging fit skips the half-advance limit', () => {
  // `ab。` hangs its mark; the 23 pt the rest needs passes half of the group's 36 pt.
  const resolved: TextMeasurer = { ...measurer, hasResolvedFont: () => true };
  const first = (overflowPunct: boolean) =>
    layout(
      '甲、乙、丙、丁、戊、己、庚ab。辛',
      160,
      13,
      resolved,
      '',
      { eastAsianDefaults: true, kern: 2, mode: 14, overflowPunct },
      'left'
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  expect(first(true)).toBe('甲、乙、丙、丁、戊、己、庚ab。');
  expect(first(false)).toBe('甲、乙、丙、丁、戊、己、庚');
});

test('a legacy group with a Latin word and no closing mark skips the half-advance limit', () => {
  // `abcd` is 48 pt: the line gives it all 36 pt of its six marks, past half its advance.
  const resolved: TextMeasurer = { ...measurer, hasResolvedFont: () => true };
  const first = (width: number) =>
    layout(
      '甲、乙、丙、丁、戊、己、庚abcd辛',
      width,
      13,
      resolved,
      '',
      { eastAsianDefaults: true, kern: 2, mode: 14 },
      'left'
    )[0]!
      .spans.map((span) => span.text)
      .join('');
  expect(first(171)).toBe('甲、乙、丙、丁、戊、己、庚abcd');
  expect(first(170)).toBe('甲、乙、丙、丁、戊、己、庚');
});

// A 32-character justified line fits only when the comma's trailing blank shrinks.
test('highlight and shading keep the fitted width of a full-width comma', () => {
  const text = '甲乙丙丁戊己庚辛壬癸子丑寅，卯辰巳午未申酉戌亥春夏秋冬风雨雷电晴雪朝暮';
  const width = 380;
  const expected = [text.slice(0, 32), text.slice(32)];
  const measure: TextMeasurer = {
    ...measurer,
    hasResolvedFont: () => true,
    inkBounds(value, style) {
      return value === '，'
        ? { left: 0.08 * style.fontSizePt, right: 0.34 * style.fontSizePt }
        : measurer.inkBounds?.(value, style);
    },
  };
  const lineTexts = (lines: ReturnType<typeof layout>) =>
    lines.map((line) => line.spans.map((span) => span.text).join(''));
  expect(lineTexts(layout(text, width, undefined, measure))).toEqual(expected);
  for (const split of [13, text.length]) {
    for (const props of ['<w:highlight w:val="yellow"/>', '<w:shd w:fill="FFFF00"/>']) {
      const fitted = layout(text, width, split, measure, props);
      expect(lineTexts(fitted)).toEqual(expected);
      const comma = fitted[0]!.spans.find((span) => span.text === '，');
      expect(comma?.box.width).toBeLessThan(12);
      expect(comma?.glyphOffsetPt ?? 0).toBe(0);
      expect(Boolean(comma?.style.highlight || comma?.style.shading)).toBe(true);
    }
    for (const props of paintRefused)
      expect(lineTexts(layout(text, width, split, measure, props))).toEqual([
        text.slice(0, 31),
        text.slice(31),
      ]);
  }
});

test('highlighted fitting keeps every glyph ink inside its own box', () => {
  // A centered colon's ink passes half its advance; a later highlight would cover it.
  const centered: TextMeasurer = {
    ...measurer,
    inkBounds: (value, style) =>
      value === '：'
        ? { left: 0.42 * style.fontSizePt, right: 0.58 * style.fontSizePt }
        : measurer.inkBounds?.(value, style),
  };
  const highlight = '<w:highlight w:val="yellow"/>';
  const inside = (lines: ReturnType<typeof layout>, measure: TextMeasurer) =>
    lines.flatMap((line) =>
      line.spans.flatMap((span) => {
        const ink = measure.inkBounds?.(span.text, span.style);
        const offset = span.glyphOffsetPt ?? 0;
        return ink && span.text.length === 1
          ? [ink.left + offset >= -0.001 && ink.right + offset <= span.box.width + 0.001]
          : [];
      })
    );
  for (const [text, measure] of [
    ['甲乙丙：丁戊己庚', centered],
    ['甲乙（丙丁）戊己', measurer],
  ] as const) {
    for (const width of [90.5, 91, 92]) {
      const lines = layout(text, width, undefined, measure, highlight);
      expect(inside(lines, measure).every(Boolean)).toBe(true);
    }
  }
  // The bound still lets the colon give its blank right side.
  const colon = layout('甲乙丙：丁戊己庚', 91, undefined, centered, highlight);
  expect(colon).toHaveLength(1);
  expect(colon[0]!.spans.find((span) => span.text === '：')?.box.width).toBeCloseTo(7, 3);
  const lines = layout('甲乙（丙丁）戊己', 90, undefined, measurer, highlight);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    '甲乙（丙丁）戊己',
  ]);
  const opening = lines[0]!.spans.find((span) => span.text === '（')!;
  expect(opening.glyphOffsetPt).toBeLessThan(0);
  expect(opening.style.highlight).toBe('yellow');
});

const trackedProps = (spacing: number) =>
  '<w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK" w:hint="eastAsia"/>' +
  `<w:lang w:eastAsia="zh-CN"/><w:spacing w:val="${spacing}"/>`;
const tracked: TextMeasurer = {
  ...measurer,
  hasResolvedFont: () => true,
  inkBounds(value, style) {
    return value === '，'
      ? { left: 0.08 * style.fontSizePt, right: 0.34 * style.fontSizePt }
      : measurer.inkBounds?.(value, style);
  },
};
const lineTexts = (lines: ReturnType<typeof layout>) =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

// A Latin run on a later line makes the paragraph mixed. It cannot veto the seams of a first
// line tracked by `w:spacing` that holds no Latin group: that line breaks as it does without the Latin run.
for (const spacing of [-4, 4]) {
  for (const hanging of [false, true]) {
    test(`a tracked East Asian line fits in a mixed paragraph (${spacing} twips, hanging ${hanging})`, () => {
      const base = '甲乙丙丁戊己，庚辛壬癸子丑寅卯辰巳午未申酉，戌亥春夏秋冬风雨雷电，晴雪朝暮';
      const wrap = (suffix: string, width: number) =>
        layout(
          base + suffix,
          width,
          undefined,
          tracked,
          trackedProps(spacing),
          undefined,
          'both',
          hanging
        );
      let fitted = 0;
      for (let width = 330; width <= 400; width += 1) {
        const mixed = wrap('A1', width);
        const pure = wrap('中文', width);
        expect(lineTexts(mixed)[0]).toBe(lineTexts(pure)[0]);
        const comma = mixed[0]!.spans.find((span) => span.text === '，' && span.box.width < 11.9);
        if (comma) {
          fitted += 1;
          // Ideographs keep their authored spacing; only the punctuation gives up blank sides.
          for (const span of mixed[0]!.spans.filter((entry) =>
            /^[\u4e00-\u9fff]+$/u.test(entry.text)
          ))
            expect(span.style.characterSpacingPt).toBe(spacing / 20);
        }
      }
      expect(fitted).toBeGreaterThan(0);
      const latin = wrap('A1', 371)
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes('A1'));
      expect(latin?.style.characterSpacingPt).toBe(spacing / 20);
    });
  }
}

// A word, a mathematical run, a symbol, or a curly quote on a tracked line keeps every bracket at
// its tracked advance, before or after the tracked text; the untracked line compresses the pair.
test('a tracked line that holds a word, a mathematical run, a symbol, or a curly quote keeps its brackets', () => {
  const props = (spacing: number) =>
    spacing ? trackedProps(spacing) : trackedProps(0).replace(/<w:spacing[^>]*\/>/u, '');
  for (const [prefix, foreign] of [
    ['', 'AV'],
    ['AV', '甲'],
    ['', '≥'],
    ['', '℃'],
    ['', '“乙”'],
  ] as const) {
    const text = `${prefix}甲乙丙丁戊己）（庚辛壬癸${foreign}子丑寅卯辰巳午未申酉戌亥春夏秋冬风雨雷电晴雪朝暮`;
    const brackets = (spacing: number, width: number) => {
      const first = layout(text, width, undefined, tracked, props(spacing))[0]!.spans;
      // Only a first line that holds the foreign text must keep its brackets.
      return first.some((span) => /[A-Z≥℃“]/u.test(span.text))
        ? first.filter((span) => /^[（）]$/u.test(span.text))
        : [];
    };
    let compressed = 0;
    let held = 0;
    for (let width = 330; width <= 400; width += 1) {
      if (brackets(0, width).some((span) => span.box.width < 11.9)) compressed += 1;
      for (const spacing of [-4, 4])
        for (const span of brackets(spacing, width)) {
          held += 1;
          expect(span.box.width).toBeCloseTo(12 + spacing / 20, 6);
        }
    }
    expect(held).toBeGreaterThan(0);
    expect(compressed).toBeGreaterThan(0);
  }
});
