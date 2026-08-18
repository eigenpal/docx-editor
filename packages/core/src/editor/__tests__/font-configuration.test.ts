import { expect, spyOn, test } from 'bun:test';
import { EditorFontError, type FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import { HarfBuzzShapingError, sha256FontBytes } from '@docx-editor.dev/core/layout';
import { createLayoutShaping, toEditorFontError } from '../font-configuration.ts';

const fontUrl = new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url);

test('adapts the public byte-backed font configuration after async HarfBuzz initialization', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const configuration: FontConfiguration = Object.freeze({
    epoch: 3,
    maxFontBytes: 2_000_000,
    sources: Object.freeze([
      Object.freeze({
        request: Object.freeze({ family: 'DejaVu Sans', weight: 400, style: 'normal' }),
        id: 'dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      }),
    ]),
    defaultFont: Object.freeze({ family: 'DejaVu Sans', sizeHalfPoints: 24 }),
  });

  const shaping = await createLayoutShaping(configuration);

  expect(shaping.fonts.epoch).toBe(3);
  expect(shaping.defaultFont).toEqual(configuration.defaultFont);
  expect(shaping.fonts.resolve(configuration.sources[0]!.request)).not.toBeInstanceOf(Error);
  shaping.shaper.dispose();
});

test('samples and owns font bytes before asynchronous initialization yields', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const hash = sha256FontBytes(bytes);
  const request = Object.freeze({ family: 'DejaVu Sans', weight: 400, style: 'normal' } as const);
  const pending = createLayoutShaping({
    epoch: 4,
    maxFontBytes: 2_000_000,
    sources: [{ request, id: 'owned-dejavu', bytes, hash, faceIndex: 0 }],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
  });

  bytes.fill(0);
  const shaping = await pending;
  const resolved = shaping.fonts.resolve(request);

  expect(resolved).not.toBeInstanceOf(Error);
  if (!(resolved instanceof Error)) expect(sha256FontBytes(resolved.bytes)).toBe(hash);
  shaping.shaper.dispose();
});

test('rejects disabling the per-font hard ceiling before allocation or admission', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  for (const maxFontBytes of [Number.MAX_SAFE_INTEGER, bytes.byteLength - 1]) {
    const counters = { copies: 0, hashes: 0, admissions: 0 };
    await expect(
      createLayoutShaping(
        {
          epoch: 5,
          maxFontBytes,
          sources: [
            {
              request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
              id: 'oversized-limit',
              bytes,
              hash: sha256FontBytes(bytes),
              faceIndex: 0,
            },
          ],
          defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
        },
        {
          onFontByteCopy: () => (counters.copies += 1),
          onFontHash: () => (counters.hashes += 1),
          onFontAdmission: () => (counters.admissions += 1),
        }
      )
    ).rejects.toMatchObject<EditorFontError>({ code: 'overLimit' });
    expect(counters).toEqual({ copies: 0, hashes: 0, admissions: 0 });
  }
});

test('rejects source count and aggregate bytes before touching any source', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const source = {
    request: { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const,
    id: 'repeated',
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  for (const sources of [
    Array.from({ length: 257 }, () => source),
    Array.from({ length: 180 }, () => source),
  ]) {
    const counters = { copies: 0, hashes: 0, admissions: 0 };
    await expect(
      createLayoutShaping(
        {
          epoch: 6,
          maxFontBytes: 2_000_000,
          sources,
          defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
        },
        {
          onFontByteCopy: () => (counters.copies += 1),
          onFontHash: () => (counters.hashes += 1),
          onFontAdmission: () => (counters.admissions += 1),
        }
      )
    ).rejects.toMatchObject<EditorFontError>({ code: 'overLimit' });
    expect(counters).toEqual({ copies: 0, hashes: 0, admissions: 0 });
  }
});

test('copies each valid source exactly once into snapshot ownership', async () => {
  const bytes = new Uint8Array(await Bun.file(fontUrl).arrayBuffer());
  const counters = { copies: 0, hashes: 0, admissions: 0 };
  const shaping = await createLayoutShaping(
    {
      epoch: 7,
      maxFontBytes: 2_000_000,
      sources: [
        {
          request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          id: 'single-copy',
          bytes,
          hash: sha256FontBytes(bytes),
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 24 },
    },
    {
      onFontByteCopy: () => (counters.copies += 1),
      onFontHash: () => (counters.hashes += 1),
      onFontAdmission: () => (counters.admissions += 1),
    }
  );

  expect(counters).toEqual({ copies: 1, hashes: 1, admissions: 1 });
  shaping.shaper.dispose();
});

test('a missing WASM keeps its code and remedy, and says so once without a handler', () => {
  // Three claims, asserted together because the console warning is once-per-session and a
  // second test could not observe it:
  //   - the CODE survives, so a host can branch on "your bundler is misconfigured" rather
  //     than matching English inside `diagnostic`;
  //   - the DIAGNOSTIC survives, because it is where the remedy is written (#282);
  //   - it reaches the console even with no `onFontError` registered. Every other font
  //     failure degrades quietly, but this one disables shaping for the whole document,
  //     and the same misconfiguration used to fail the BUILD — a silent console after a
  //     green build would be strictly worse.
  const failure = new HarfBuzzShapingError('wasmUnavailable', {
    diagnostic: 'serve `@docx-editor.dev/core/harfbuzz.wasm` and call `setHarfBuzzWasmUrl`',
  });
  const error = spyOn(console, 'error').mockImplementation(() => {});

  try {
    const surfaced = toEditorFontError(failure);

    expect(surfaced).toBeInstanceOf(EditorFontError);
    expect(surfaced.code).toBe('wasmUnavailable');
    expect(surfaced.diagnostic).toContain('setHarfBuzzWasmUrl');
    expect(surfaced.cause).toBe(failure);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('text shaping is disabled');

    // A document with many unshapeable runs must not turn the console into a log.
    toEditorFontError(failure);
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
  }
});

test('shaping failures that are not the WASM keep reporting as initializationFailed', () => {
  // The new branch must not relabel the resource-limit codes, which are document faults
  // and were already mapped this way.
  const surfaced = toEditorFontError(new HarfBuzzShapingError('glyphOverLimit', { limit: 10 }));

  expect(surfaced.code).toBe('initializationFailed');
});
