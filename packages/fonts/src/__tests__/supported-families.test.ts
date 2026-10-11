import { expect, test } from 'bun:test';
import { packagedFonts } from '../index.ts';
import { googleFonts } from '../google-fonts.ts';
import { composeFontOrigins, defineFontResolver } from '../../../core/src/editor/font-resolver.ts';
import { availableFontFamilies } from '../../../core/src/editor/font-catalog.ts';

const request = { families: [], defaultFamily: 'Unknown' };
const noFetch = (() => {
  throw new Error('Catalog discovery must not fetch bytes');
}) as unknown as typeof fetch;

test('packaged font support is independent of document content and respects allow', async () => {
  const fragment = await packagedFonts({ allow: ['Arial', 'Cambria'], fetcher: noFetch })(request);
  expect(fragment.supportedFamilies).toEqual(['Cambria', 'Arial']);
  expect(fragment.sources).toEqual([]);
  expect(fragment.families).toEqual([]);
});

test('Google support respects target restrictions and custom aliases without fetching', async () => {
  const fragment = await googleFonts({
    allow: ['Lato'],
    substitute: { 'Brand Face': 'Lato', 'Broken Face': 'Missing' },
    fetcher: noFetch,
  })(request);
  expect(fragment.supportedFamilies).toEqual(['Lato', 'Brand Face']);
  expect(fragment.sources).toEqual([]);
});

test('catalogs survive origin composition and sanitize names without claiming loaded faces', async () => {
  const fragment = await composeFontOrigins(
    [
      defineFontResolver(() => ({ supportedFamilies: ['Brand Face', "bad'name"] })),
      googleFonts({ allow: ['Lato'], fetcher: noFetch }),
    ],
    request
  );
  expect(fragment?.supportedFamilies).toEqual(['Brand Face', 'Lato']);
  expect(fragment?.sources).toEqual([]);
  expect(availableFontFamilies(fragment, [])).toContain('Brand Face');
});

test.each(['Brand One;Brand Two', 'Brand One,Brand Two'])(
  'catalog composition retains a complete font name: %s',
  async (family) => {
    const fragment = await composeFontOrigins(
      [
        defineFontResolver(() => ({ supportedFamilies: [family] })),
        googleFonts({ allow: ['Lato'], fetcher: noFetch }),
      ],
      request
    );
    expect(fragment?.supportedFamilies).toEqual([family, 'Lato']);
    expect(fragment?.sources).toEqual([]);
    const available = availableFontFamilies(fragment, []);
    expect(available).toContain(family);
    expect(available).not.toContain('Brand One');
    expect(available).not.toContain('Brand Two');
  }
);
