// `googleFonts({ cjk })`: regional Noto Sans faces for East Asian families.
//
// - off by default, so no existing host starts a multi-megabyte download
// - each declared family loads its own regional face, never the others
// - the default loads in the background; `loading: 'wait'` answers with the faces
// - every face is pinned to one revision and carries its hash

import { describe, expect, test } from 'bun:test';
import type { CjkFontLoading as PackagedCjkFontLoading } from '../../../fonts-cjk/src/browser.ts';
import {
  CJK_SUBSTITUTED_FAMILIES,
  LOCALIZED_CJK_FAMILIES,
} from '../../../fonts-cjk/src/families.ts';
import { GOOGLE_CJK_FACES, googleCjkFaceFor } from '../google-cjk.ts';
import {
  GOOGLE_FONT_CATALOG,
  GOOGLE_FONT_FAMILIES,
  googleFonts,
  type CjkFontLoading,
  type GoogleFontsFragment,
  type GoogleFontsOptions,
} from '../google-fonts.ts';

function fakeFetcher(): { fetcher: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const face = [...GOOGLE_CJK_FACES, ...GOOGLE_FONT_CATALOG].find((entry) => entry.url === url);
    if (!face) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(new Uint8Array(face.byteLength)));
  }) as typeof fetch;
  return { fetcher, requested };
}

const resolve = (
  families: readonly string[],
  fetcher: typeof fetch,
  cjk: GoogleFontsOptions['cjk']
) =>
  googleFonts({ fetcher, cjk, onFailure: () => {} })({
    families,
    defaultFamily: 'No Such Family',
  });

const families = (fragment: GoogleFontsFragment | undefined) =>
  (fragment?.sources ?? []).map((source) => source.request.family).sort();

// The two packages declare the same loading type without depending on each other; this fails
// to compile if one drifts.
const sameLoadingType: [CjkFontLoading] extends [PackagedCjkFontLoading]
  ? [PackagedCjkFontLoading] extends [CjkFontLoading]
    ? true
    : false
  : false = true;

describe('googleFonts cjk', () => {
  test('declares the same loading type as fonts-cjk', () => {
    expect(sameLoadingType).toBe(true);
  });

  test('pins every regional face to one revision, with its hash', () => {
    expect(GOOGLE_CJK_FACES.map((face) => face.family)).toEqual([
      'Noto Sans JP',
      'Noto Sans SC',
      'Noto Sans TC',
      'Noto Sans KR',
    ]);
    for (const face of GOOGLE_CJK_FACES) {
      expect(face.url).toStartWith(
        'https://cdn.jsdelivr.net/gh/google/fonts@beff1d8226e598dfaf06f9f8312c01021f70e9d2/ofl/'
      );
      expect(face.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  test('is off by default', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolve(['SimSun', 'MS Mincho'], fetcher, undefined);
    expect(fragment.sources).toEqual([]);
    expect(fragment.deferred).toBeUndefined();
    expect(requested).toEqual([]);
  });

  test('loads in the background and answers the faces on deferred', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolve(['SimSun', 'ＭＳ 明朝'], fetcher, true);
    expect(fragment.sources).toEqual([]);
    const late = await fragment.deferred;
    expect(families(late)).toEqual(['Noto Sans JP', 'Noto Sans SC']);
    expect(requested).toHaveLength(2);
    // Every face of the declared family points at the one regional face.
    expect(
      late!.substitutions.filter((entry) => entry.from.family === 'SimSun').map((entry) => entry.to)
    ).toEqual(Array(4).fill({ family: 'Noto Sans SC', weight: 400, style: 'normal' }));
  });

  test("loading: 'wait' answers the faces at once", async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Malgun Gothic', 'PMingLiU'], fetcher, { loading: 'wait' });
    expect(families(fragment)).toEqual(['Noto Sans KR', 'Noto Sans TC']);
    expect(fragment.deferred).toBeUndefined();
  });

  test('skips a face an earlier origin already paints', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await googleFonts({ fetcher, cjk: true })({
      families: ['SimSun'],
      defaultFamily: 'No Such Family',
      resolvedFaces: [
        { family: 'SimSun', weight: 400, style: 'normal' },
        { family: 'SimSun', weight: 700, style: 'normal' },
        { family: 'SimSun', weight: 400, style: 'italic' },
        { family: 'SimSun', weight: 700, style: 'italic' },
      ],
    });
    expect(fragment.deferred).toBeUndefined();
    expect(requested).toEqual([]);
  });

  test('a covered regular face still leaves the bold and italic to this origin', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await googleFonts({ fetcher, cjk: { loading: 'wait' } })({
      families: ['SimSun'],
      defaultFamily: 'No Such Family',
      resolvedFaces: [{ family: 'SimSun', weight: 400, style: 'normal' }],
    });
    expect(families(fragment)).toEqual(['Noto Sans SC']);
  });

  test('a failed face is reported, and the others still arrive', async () => {
    const failed: string[] = [];
    const base = fakeFetcher().fetcher;
    const fetcher = ((input: RequestInfo | URL) =>
      String(input).includes('notosanssc')
        ? Promise.resolve(new Response(null, { status: 503 }))
        : base(input)) as typeof fetch;
    const fragment = await googleFonts({
      fetcher,
      cjk: true,
      onFailure: (failure) => failed.push(failure.family),
    })({ families: ['SimSun', 'Batang'], defaultFamily: 'No Such Family' });
    const late = await fragment.deferred;
    expect(families(late)).toEqual(['Noto Sans KR']);
    expect(late!.substitutions.some((entry) => entry.from.family === 'SimSun')).toBe(false);
    expect(failed).toEqual(['Noto Sans SC']);
  });

  test('a document naming the regional family gets its bold and italic too', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Noto Sans JP'], fetcher, { loading: 'wait' });
    expect(families(fragment)).toEqual(['Noto Sans JP']);
    expect(
      fragment.substitutions
        .filter((entry) => entry.from.family === 'Noto Sans JP')
        .map((entry) => `${entry.from.weight} ${entry.from.style}`)
        .sort()
    ).toEqual(['400 italic', '700 italic', '700 normal']);
  });

  test('CJK faces do not evict the Latin faces from the download cache', async () => {
    const { fetcher, requested } = fakeFetcher();
    const latin = () =>
      googleFonts({ fetcher, onFailure: () => {} })({ families: ['Lato'], defaultFamily: 'Lato' });
    await latin();
    const latinRequests = requested.length;
    expect(latinRequests).toBeGreaterThan(0);
    // Three regions, 18.8 MB together: more than the whole Latin cache holds.
    await resolve(['SimSun', 'PMingLiU', 'Batang'], fetcher, { loading: 'wait' });
    requested.length = 0;
    await latin();
    expect(requested).toEqual([]);
  });
});

test('serves every East Asian family the packaged CJK resolver knows', () => {
  const names = [...CJK_SUBSTITUTED_FAMILIES, ...LOCALIZED_CJK_FAMILIES.keys()];
  expect(names.filter((name) => googleCjkFaceFor(name) === undefined)).toEqual([]);
});

test('a regional face an earlier origin paints is not downloaded again', async () => {
  const { fetcher, requested } = fakeFetcher();
  const fragment = await googleFonts({ fetcher, cjk: { loading: 'wait' } })({
    families: ['MS Mincho'],
    defaultFamily: 'No Such Family',
    resolvedFaces: [{ family: 'Noto Sans JP', weight: 400, style: 'normal' }],
  });
  expect(requested).toEqual([]);
  expect(fragment.substitutions.some((entry) => entry.from.family === 'MS Mincho')).toBe(true);
});

test('the font picker list offers the English CJK names only when cjk is on', async () => {
  const { fetcher } = fakeFetcher();
  const request = { families: [], defaultFamily: 'No Such Family' };
  const off = await googleFonts({ fetcher })(request);
  const on = await googleFonts({ fetcher, cjk: true })(request);
  expect(off.supportedFamilies).not.toContain('SimSun');
  expect(on.supportedFamilies).toContain('SimSun');
  expect(on.supportedFamilies).not.toContain('宋体');
});

test('a font pick tells the families this package serves apart by script', async () => {
  // The editor writes a pick to w:eastAsia only for an East Asian family. A Latin family it
  // can serve must never count, and every CJK family it can serve must.
  const { isEastAsianFontFamily } =
    await import('../../../core/src/store/package/default-font-faces.ts');
  const latin = [
    ...GOOGLE_FONT_FAMILIES,
    ...[
      'Calibri',
      'Cambria',
      'Century Gothic',
      'Courier New',
      'HK Grotesk',
      'Alegreya SC',
      'M PLUS Code Latin',
    ],
  ];
  expect(latin.filter((family) => isEastAsianFontFamily(family))).toEqual([]);
  const eastAsian = [
    ...GOOGLE_CJK_FACES.map((face) => face.family),
    ...CJK_SUBSTITUTED_FAMILIES,
    ...LOCALIZED_CJK_FAMILIES.keys(),
    'M PLUS 1p',
    'Noto Sans CJK JP',
    'Noto Sans Mono CJK SC',
  ];
  expect(eastAsian.filter((family) => !isEastAsianFontFamily(family))).toEqual([]);
});
