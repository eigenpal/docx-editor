// The WASM URL escape hatch (#282).
//
// The inlined HarfBuzz runtime locates its binary through
// `resolveHarfBuzzWasmBinaryUrl`, wired in by the build. These tests pin the contract the
// runtime and `setHarfBuzzWasmUrl` share: the override wins, the bundler's URL is the
// fallback, the location is read once, and a call that arrives too late says so instead of
// throwing at a consumer who is following the error's own advice.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  harfBuzzWasmUnavailableDiagnostic,
  resetHarfBuzzWasmUrlForTests,
  resolveHarfBuzzWasmBinaryUrl,
  setHarfBuzzWasmUrl,
} from '../harfbuzz-wasm-binary.ts';

const BUNDLER_URL = 'https://app.example/assets/harfbuzz-abc123.wasm';
const SERVED_URL = 'https://app.example/static/harfbuzz.wasm';

afterEach(() => {
  resetHarfBuzzWasmUrlForTests();
});

describe('resolveHarfBuzzWasmBinaryUrl', () => {
  test('without an override, the bundler-resolved URL passes through untouched', () => {
    // The webpack/Turbopack/Vite path: those bundlers emit the asset and rewrite the URL
    // themselves, and the escape hatch must not get in their way.
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(BUNDLER_URL);
  });

  test('an override set before the runtime reads wins over the bundler URL', () => {
    // The esbuild/Bun path: nothing was emitted, the argument would 404, and the
    // consumer-served copy is the one that loads.
    setHarfBuzzWasmUrl(SERVED_URL);
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(SERVED_URL);
  });

  test('a URL object is accepted and normalised to its string form', () => {
    setHarfBuzzWasmUrl(new URL(SERVED_URL));
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(SERVED_URL);
  });
});

describe('setHarfBuzzWasmUrl after the runtime has read its location', () => {
  test('a late call warns and does not throw', () => {
    // The documented remedy for `wasmUnavailable` is to call this function. A consumer who
    // does that from an error handler must not be met with a second exception — the module
    // cache pins the runtime either way, so the honest answer is "noted, reload".
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => setHarfBuzzWasmUrl(SERVED_URL)).not.toThrow();
      expect(warn.mock.calls[0]?.[0]).toContain('reload');
    } finally {
      warn.mockRestore();
    }
  });

  test('re-setting the URL the runtime already resolved is silent', () => {
    setHarfBuzzWasmUrl(SERVED_URL);
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setHarfBuzzWasmUrl(SERVED_URL);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('setHarfBuzzWasmUrl input validation', () => {
  test.each([
    ['a number', 42],
    ['null', null],
    ['an object', {}],
  ])('%s is refused with a TypeError', (_label, value) => {
    // The failure this API exists to fix already surfaces three steps away from its cause.
    // Coercing junk with String() would add a fourth.
    expect(() => setHarfBuzzWasmUrl(value as unknown as string)).toThrow(TypeError);
  });

  test('an empty string is refused rather than resolving to the current page', () => {
    expect(() => setHarfBuzzWasmUrl('   ')).toThrow(TypeError);
  });
});

describe('harfBuzzWasmUnavailableDiagnostic', () => {
  test('names the API that fixes it, the file to serve, and the underlying cause', () => {
    // This string is the ONLY thing a consumer sees when their bundler emits no asset, so
    // every part of the remedy has to survive in it.
    const diagnostic = harfBuzzWasmUnavailableDiagnostic(new Error('ENOENT: no such file'));

    expect(diagnostic).toContain('setHarfBuzzWasmUrl');
    expect(diagnostic).toContain('@docx-editor.dev/core/harfbuzz.wasm');
    expect(diagnostic).toContain('ENOENT: no such file');
  });

  test('reports the location actually read, so the advice points somewhere real', () => {
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);
    expect(harfBuzzWasmUnavailableDiagnostic(new Error('404'))).toContain(BUNDLER_URL);
  });
});
