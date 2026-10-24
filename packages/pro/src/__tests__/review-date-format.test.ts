import { expect, test } from 'bun:test';
import { reviewDateFormat as reactFormat } from '../react/review-shared.ts';
import { reviewDateFormat as vueFormat } from '../vue/review-shared.ts';

const when = new Date(Date.UTC(2026, 9, 25, 9, 5));

for (const [adapter, reviewDateFormat] of [
  ['react', reactFormat],
  ['vue', vueFormat],
] as const) {
  test(`${adapter}: a translated rail formats dates in its language`, () => {
    expect(reviewDateFormat('ar').resolvedOptions().locale).toStartWith('ar');
    expect(reviewDateFormat('ar').format(when)).not.toMatch(/Oct/u);
    expect(reviewDateFormat('ar')).toBe(reviewDateFormat('ar'));
  });

  test(`${adapter}: the default English catalog keeps the browser locale`, () => {
    const browser = new Intl.DateTimeFormat().resolvedOptions().locale;
    expect(reviewDateFormat('en').resolvedOptions().locale).toBe(browser);
  });

  test(`${adapter}: an invalid language tag falls back to the browser locale`, () => {
    const browser = new Intl.DateTimeFormat().resolvedOptions().locale;
    expect(reviewDateFormat('not a tag!').resolvedOptions().locale).toBe(browser);
  });
}
