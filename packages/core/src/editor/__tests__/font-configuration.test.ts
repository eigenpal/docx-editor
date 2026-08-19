import { expect, spyOn, test } from 'bun:test';
import { EditorFontError, type FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import { HarfBuzzShapingError, sha256FontBytes } from '@docx-editor.dev/core/layout';
import {
  createLayoutShaping,
  resetFontFailureWarningForTests,
  toEditorFontError,
  warnFontFailureOnce,
} from '../font-configuration.ts';

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

test('a shaper that never loaded keeps its code and its remedy out to the host', () => {
  // `onFontError` is the only surface a host sees. The CODE has to survive so a host can
  // branch on "your bundler is misconfigured" rather than matching English inside
  // `diagnostic`, and the diagnostic has to survive because it is where the remedy is
  // written (#282). `toEditorFontError` is public API, so it stays a pure mapper —
  // the console side of this lives in `reportFontError`, which knows who is listening.
  const failure = new HarfBuzzShapingError('wasmUnavailable', {
    diagnostic: 'serve `@docx-editor.dev/core/harfbuzz.wasm` and call `setHarfBuzzWasmUrl`',
  });

  const surfaced = toEditorFontError(failure);

  expect(surfaced).toBeInstanceOf(EditorFontError);
  expect(surfaced.code).toBe('wasmUnavailable');
  expect(surfaced.diagnostic).toContain('setHarfBuzzWasmUrl');
  expect(surfaced.cause).toBe(failure);
});

test('a stale self-hosted binary reports as the same host-deployment fault', () => {
  // The second step of the documented workflow: copy the wasm, then upgrade the package
  // and forget to re-copy it. Version mismatch is the same class of problem as a missing
  // binary — the shaper is not running — so it must not collapse into the generic code.
  const surfaced = toEditorFontError(
    new HarfBuzzShapingError('shapingLibraryMismatch', {
      diagnostic: 'expected HarfBuzz 14.3.0, loaded 14.2.1. Re-copy …',
    })
  );

  expect(surfaced.code).toBe('wasmUnavailable');
  expect(surfaced.diagnostic).toContain('Re-copy');
});

test('an unsupported Node runtime is NOT labeled wasmUnavailable', () => {
  // A host branching on `wasmUnavailable` shows the serve-the-binary remedy. On a Node
  // that predates `process.getBuiltinModule` no URL helps, so that failure keeps the
  // generic code and carries the upgrade advice in `diagnostic` instead.
  const surfaced = toEditorFontError(
    new HarfBuzzShapingError('unsupportedRuntime', {
      diagnostic: 'upgrade Node; `setHarfBuzzWasmUrl` does not apply here',
    })
  );

  expect(surfaced.code).toBe('initializationFailed');
  expect(surfaced.diagnostic).toContain('upgrade Node');
});

test('shaping failures that are not the shaper keep reporting as initializationFailed', () => {
  // The new branch must not relabel the resource-limit codes, which are document faults
  // and were already mapped this way.
  const surfaced = toEditorFontError(new HarfBuzzShapingError('glyphOverLimit', { limit: 10 }));

  expect(surfaced.code).toBe('initializationFailed');
});

test('the shaper-failure console warning fires once, and only for the whole-document fault', () => {
  // Every other font failure degrades quietly on purpose. This one disables shaping for the
  // entire document, and before #282 was fixed the same misconfiguration failed the BUILD —
  // so a green build with a silent console would be a strictly worse trade.
  resetFontFailureWarningForTests();
  const error = spyOn(console, 'error').mockImplementation(() => {});

  try {
    warnFontFailureOnce({ diagnostic: 'serve the binary' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('text shaping is disabled');

    // A document with many unshapeable runs must not turn the console into a log.
    warnFontFailureOnce({ diagnostic: 'serve the binary' });
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
    resetFontFailureWarningForTests();
  }
});
