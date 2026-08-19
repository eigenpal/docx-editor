// The WASM URL escape hatch (#282).
//
// The inlined HarfBuzz runtime locates its binary through
// `resolveHarfBuzzWasmBinaryUrl`, wired in by the build. These tests pin the contract the
// runtime and `setHarfBuzzWasmUrl` share: the override wins, the bundler's URL is the
// fallback, the location is read once, and a call that arrives too late says so instead of
// throwing at a consumer who is following the error's own advice.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  harfBuzzVersionMismatchDiagnostic,
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

describe('setHarfBuzzWasmUrl with two disagreeing callers before the first read', () => {
  test('the conflict is said out loud and the later caller wins', () => {
    // Silent last-write-wins hid a real integration bug: two modules configuring one host
    // with different locations, and whichever loaded second decided the outcome.
    setHarfBuzzWasmUrl('https://app.example/a/harfbuzz.wasm');
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setHarfBuzzWasmUrl(SERVED_URL);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('later one wins');
    } finally {
      warn.mockRestore();
    }
    expect(resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL)).toBe(SERVED_URL);
  });
});

describe('URL redaction in diagnostics', () => {
  test('a signed URL loses its query string before reaching an error message', () => {
    // Signed asset URLs carry their credential in the query, and diagnostics end up in
    // logs and bug reports.
    setHarfBuzzWasmUrl('https://cdn.example/assets/harfbuzz.wasm?token=SECRET123');
    resolveHarfBuzzWasmBinaryUrl(BUNDLER_URL);

    const diagnostic = harfBuzzWasmUnavailableDiagnostic(new Error('404'));

    expect(diagnostic).not.toContain('SECRET123');
    expect(diagnostic).toContain('https://cdn.example/assets/harfbuzz.wasm');
  });
});

describe('a Node runtime without process.getBuiltinModule', () => {
  test('is told to upgrade Node, not to serve a WASM file', () => {
    // The shim's throw is the marker. Serving a binary cannot fix a missing builtin, so
    // the standard remedy would send that consumer chasing an asset problem they do not
    // have.
    const diagnostic = harfBuzzWasmUnavailableDiagnostic(
      new Error(
        "Aborted(Error: createRequire is unavailable: this build reaches Node's `module` " +
          'through process.getBuiltinModule, which needs Node 20.16+ or 22.3+.)'
      )
    );

    expect(diagnostic).toContain('Upgrade Node');
    expect(diagnostic).toContain('does not apply');
    expect(diagnostic).not.toContain('serve `@docx-editor.dev/core/harfbuzz.wasm` yourself');
  });
});

describe('harfBuzzVersionMismatchDiagnostic', () => {
  test('a self-hosted copy is told which file went stale and what to do', () => {
    // The second step of the workflow the docs send esbuild/Bun consumers down: copy the
    // binary, then upgrade the package. Two version numbers alone name no remedy.
    setHarfBuzzWasmUrl(SERVED_URL);

    const diagnostic = harfBuzzVersionMismatchDiagnostic('14.3.0', '14.2.1');

    expect(diagnostic).toContain(SERVED_URL);
    expect(diagnostic).toContain('Re-copy');
    expect(diagnostic).toContain('14.2.1');
  });

  test('a bundled copy is not told to re-copy a file it never served', () => {
    // Without an override the binary came from the bundler, so the re-copy advice would
    // send the reader looking for a file they never created.
    const diagnostic = harfBuzzVersionMismatchDiagnostic('14.3.0', '14.2.1');

    expect(diagnostic).not.toContain('Re-copy');
    expect(diagnostic).toContain('does not match this build');
  });
});
