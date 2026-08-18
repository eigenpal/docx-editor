// The WASM URL escape hatch (#282).
//
// The inlined HarfBuzz runtime locates its binary through
// `resolveHarfBuzzWasmBinaryUrl`, wired in by the build. These tests pin the contract the
// runtime and `setHarfBuzzWasmUrl` share: the override wins, the bundler's URL is the
// fallback, the location is read once, and a change after that read REFUSES instead of
// silently doing nothing.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  resetHarfBuzzWasmUrlForTests,
  resolveHarfBuzzWasmBinaryUrl,
  setHarfBuzzWasmUrl,
} from '../harfbuzz-wasm-binary.ts';

const BUNDLER_URL = 'https://app.example/assets/harfbuzz-abc123.wasm';

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
    setHarfBuzzWasmUrl('https://app.example/static/harfbuzz.wasm');
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(
      'https://app.example/static/harfbuzz.wasm'
    );
  });

  test('a URL object is accepted and normalised to its string form', () => {
    setHarfBuzzWasmUrl(new URL('https://app.example/static/harfbuzz.wasm'));
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(
      'https://app.example/static/harfbuzz.wasm'
    );
  });
});

describe('setHarfBuzzWasmUrl after the runtime has read its location', () => {
  test('a different URL throws instead of being silently ignored', () => {
    // The runtime reads the location once, at first WASM instantiation. A later set would
    // change nothing, and "set but unused" is the failure mode this API exists to avoid.
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);
    expect(() => setHarfBuzzWasmUrl('https://app.example/elsewhere/harfbuzz.wasm')).toThrow(
      /already resolved its binary/
    );
  });

  test('re-setting the URL the runtime already resolved is a no-op, not an error', () => {
    // Two independent module inits racing to configure the same host should not blow up
    // when they agree.
    setHarfBuzzWasmUrl('https://app.example/static/harfbuzz.wasm');
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);
    expect(() => setHarfBuzzWasmUrl('https://app.example/static/harfbuzz.wasm')).not.toThrow();
  });
});
