import { font, paragraphChanges } from './editing-schemas';

export const isDraftXmlText = (value: string) =>
  !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);

/** Draft limits reject known unsupported values before whole-body replacement. */
export const draftFont = font.refine(
  (value) =>
    (value.size === undefined ||
      (Math.round(value.size * 2) >= 1 && Math.round(value.size * 2) <= 1999)) &&
    (value.name === undefined || isDraftXmlText(value.name)),
  'Draft fonts require XML-safe names and sizes that round to 1–1999 half-points.'
);

export const draftChanges = paragraphChanges.refine(
  (changes) =>
    changes.every(({ property, value }) => {
      if (property === 'style') return false;
      if (property in font.shape) return draftFont.safeParse({ [property]: value }).success;
      if (typeof value !== 'number') return true;
      const twips = Math.round(value * 20);
      if (Math.abs(twips) > 31680) return false;
      if (property === 'spaceBefore' || property === 'spaceAfter') return twips >= 0;
      if (property === 'lineSpacing') return twips > 0;
      return true;
    }),
  'Use block.style for draft paragraph styles. Draft lists use Normal. After rounding to twips, spacing must be nonnegative, line spacing positive, and all measurements within ±31680 twips.'
);
