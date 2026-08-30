import { expect, test } from 'bun:test';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import { acquireSharedExportShaping } from '../shared-export-shaping.ts';

const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);

test('shares font admission and HarfBuzz initialization across repeated concurrent exporters', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const counters = { loads: 0, copies: 0, hashes: 0, admissions: 0 };
  const provider = {
    cacheKey: `test:shared:${crypto.randomUUID()}`,
    async loadConfiguration() {
      counters.loads += 1;
      return {
        epoch: 1,
        maxFontBytes: 2_000_000,
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
            id: 'shared-dejavu',
            bytes,
            hash: sha256FontBytes(bytes),
            faceIndex: 0,
          },
        ],
        defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
      };
    },
  };
  const instrumentation = {
    onFontByteCopy: () => (counters.copies += 1),
    onFontHash: () => (counters.hashes += 1),
    onFontAdmission: () => (counters.admissions += 1),
  };

  const [first, second, third] = await Promise.all([
    acquireSharedExportShaping(provider, instrumentation),
    acquireSharedExportShaping(provider, instrumentation),
    acquireSharedExportShaping(provider, instrumentation),
  ]);

  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(first.createMeasurer()).not.toBe(first.createMeasurer());
  expect(counters).toEqual({ loads: 1, copies: 1, hashes: 1, admissions: 1 });
});

test('evicts failed shared initialization so transient provisioning can retry', async () => {
  let attempts = 0;
  const cacheKey = `test:retry:${crypto.randomUUID()}`;
  const provider = {
    cacheKey,
    async loadConfiguration() {
      attempts += 1;
      throw new Error('transient font read');
    },
  };
  await expect(acquireSharedExportShaping(provider)).rejects.toThrow('transient font read');
  await expect(acquireSharedExportShaping(provider)).rejects.toThrow('transient font read');
  expect(attempts).toBe(2);
});

test('rejects an over-limit shared source set before traversing its entries', async () => {
  let entryReads = 0;
  const sources = new Array(257);
  Object.defineProperty(sources, 0, {
    get() {
      entryReads += 1;
      throw new Error('source entry must not be visited');
    },
  });

  await expect(
    acquireSharedExportShaping({
      cacheKey: `test:bounded:${crypto.randomUUID()}`,
      async loadConfiguration() {
        return {
          epoch: 1,
          maxFontBytes: 2_000_000,
          sources,
          defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
        };
      },
    })
  ).rejects.toThrow('Font source count');
  expect(entryReads).toBe(0);
});
