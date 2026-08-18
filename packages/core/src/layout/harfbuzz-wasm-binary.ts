// Where the HarfBuzz runtime finds its `.wasm`, and the one escape hatch for
// bundlers that lose it.
//
// The runtime ships inlined in this package's ESM build, and its loader locates the
// binary with `new URL('harfbuzz.wasm', import.meta.url)`. Webpack, Turbopack and
// Vite recognise that expression, emit `harfbuzz.wasm` as an asset and rewrite the
// URL — the reason a Next or Vite app needs no configuration. But the pattern is a
// convention, not a standard: esbuild and Bun leave the expression untouched and
// emit nothing, so the fetch 404s at runtime after a clean build.
//
// This module is the canonical explanation of that; everything else points here.

/** Set by the build. False in the CJS output, where the loader is never patched. */
declare const __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__: boolean | undefined;

/**
 * Whether the loader in THIS build was patched to read the override.
 *
 * Only the ESM build inlines harfbuzzjs and rewrites its glue, so only there does anything
 * read what the setter stores. Running from source — tests, and any consumer compiling
 * `src` — has no `define` and behaves like the ESM build, which is the one it mirrors.
 */
const wasmUrlSupported = (): boolean =>
  typeof __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__ === 'undefined' ||
  __DOCX_HARFBUZZ_WASM_URL_SUPPORTED__;

let overrideUrl: string | null = null;
let readUrl: string | null = null;

/** Absolute where possible, so two spellings of one location compare equal. */
function normalize(url: string | URL): string {
  if (url instanceof URL) return url.href;
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/**
 * Point the text shaper at an externally hosted copy of `harfbuzz.wasm`.
 *
 * Needed only under bundlers that do not emit `new URL(..., import.meta.url)`
 * assets. esbuild and Bun are the common ones, and so is any build that inlines
 * dynamic imports, such as a library bundle. There, the build succeeds and the
 * shaper fails at runtime with an `EditorFontError` whose code is
 * `wasmUnavailable`; this function is the fix. Webpack, Turbopack and Vite emit
 * the binary on their own, and passing a URL there simply overrides theirs.
 *
 * ```ts
 * import { setHarfBuzzWasmUrl } from '@docx-editor.dev/core/layout';
 * setHarfBuzzWasmUrl('/static/harfbuzz.wasm');
 * ```
 *
 * Pass a URL your application controls. It is fetched and instantiated as
 * WebAssembly, so never derive it from user input, a query parameter, or remote
 * configuration. Serving it cross-origin needs that origin in your `connect-src`
 * CSP directive, and WebAssembly needs `wasm-unsafe-eval` in `script-src` either
 * way.
 *
 * Call it before the first editor is created. The runtime reads the location once
 * and caches the result, so a call afterwards warns and does nothing: fix the
 * call site and reload. The file to serve is exported as
 * `@docx-editor.dev/core/harfbuzz.wasm`, and it must be the copy from the
 * installed package version, because the runtime refuses a version mismatch at
 * load rather than shaping with unverified metrics.
 *
 * @public
 */
export function setHarfBuzzWasmUrl(url: string | URL): void {
  if (typeof url !== 'string' && !(url instanceof URL)) {
    throw new TypeError(`setHarfBuzzWasmUrl: expected a string or URL, received ${typeof url}`);
  }
  if (typeof url === 'string' && url.trim() === '') {
    throw new TypeError('setHarfBuzzWasmUrl: expected a non-empty URL');
  }
  if (!wasmUrlSupported()) {
    // Refused rather than ignored. The CommonJS build loads harfbuzzjs from node_modules
    // instead of inlining it, so nothing here would ever be read — and a setter that
    // silently does nothing is the exact failure this module exists to prevent.
    throw new Error(
      'setHarfBuzzWasmUrl is not supported by the CommonJS build, which loads the shaper ' +
        'from node_modules and finds its binary on disk. Import the ESM build instead.'
    );
  }
  const next = normalize(url);
  if (readUrl !== null && readUrl !== next) {
    // A warning, not a throw. The documented remedy for `wasmUnavailable` is to call this
    // function, and a consumer who does so from an error handler must not be met with a
    // second exception — the module cache pins the runtime either way, so the honest
    // answer is "noted, reload".
    console.warn(
      `setHarfBuzzWasmUrl: the shaper already read its binary location from ${readUrl}, ` +
        'so this call has no effect in the current session. Move the call before the first ' +
        'editor is created and reload the page.'
    );
    return;
  }
  overrideUrl = next;
}

/**
 * What the runtime's loader actually reads, wired in at build time.
 *
 * The build rewrites the loader's `new URL('harfbuzz.wasm', import.meta.url).href`
 * into a call through here, keeping the original expression as the argument so
 * asset-emitting bundlers still see the pattern they rewrite. Not public API: the
 * inlined runtime is its only intended caller.
 */
export function resolveHarfBuzzWasmBinaryUrl(bundlerResolvedUrl: string): string {
  readUrl = overrideUrl ?? bundlerResolvedUrl;
  return readUrl;
}

/**
 * The remedy text for a runtime that could not load its binary.
 *
 * Lives here, beside the API it names, so the advice and the setter cannot drift apart.
 */
export function harfBuzzWasmUnavailableDiagnostic(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const location = readUrl === null ? 'its bundled location' : readUrl;
  return (
    `the HarfBuzz WASM binary could not be loaded from ${location}. If this bundler does ` +
    'not emit `new URL(..., import.meta.url)` assets (esbuild, Bun, and library builds ' +
    'that inline dynamic imports), serve `@docx-editor.dev/core/harfbuzz.wasm` yourself, ' +
    "point `setHarfBuzzWasmUrl` from '@docx-editor.dev/core/layout' at it before creating " +
    `an editor, and reload the page. (${detail})`
  );
}

/** Test seam: forget both URLs so one test's override cannot leak into the next. */
export function resetHarfBuzzWasmUrlForTests(): void {
  overrideUrl = null;
  readUrl = null;
}
