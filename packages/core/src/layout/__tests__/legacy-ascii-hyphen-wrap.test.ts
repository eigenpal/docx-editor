import { expect, test } from 'bun:test';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { cjkAutofitBreaks } from '../autofit-unwrapped-text.ts';
import { DEFAULT_CJK_TYPOGRAPHY, type CjkParagraphTypography } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

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

test.each(['甲AB123-2048乙', 'well-known', 'かなAB123-2048', '甲2026-2048'])(
  'legacy punctuation compression keeps an ASCII hyphen word whole in %s',
  (text) => {
    const runs = pieces(text);
    const cut = text.indexOf('-') + 1;
    const breaks = cjkParagraphBreaks(runs, policy);
    expect(breaks?.boundaries(runs[0]!)).not.toContain(cut);
    expect(breaks?.decision(runs[0]!, cut, '', '')).toBe('continues');
    expect(breaks?.cutAllowed(runs[0]!, 0, cut)).toBe(true);
  }
);

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

test('legacy ASCII hyphen grouping preserves other dash breaks and explicit character wrapping', () => {
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
