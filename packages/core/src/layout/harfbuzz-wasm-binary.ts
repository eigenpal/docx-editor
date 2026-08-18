// Where the HarfBuzz runtime finds its `.wasm`, and the one escape hatch for
// bundlers that lose it.
//
// The runtime ships inlined in this package's ESM build, and its loader locates the
// binary with `new URL('harfbuzz.wasm', import.meta.url)`. Webpack, Turbopack and
// Vite all recognise that expression, emit `dist/harfbuzz.wasm` as an asset and
// rewrite the URL — the reason a Next or Vite app needs no configuration. But the
// pattern is a convention, not a standard: esbuild and Bun leave the expression
// untouched and emit nothing, so the fetch 404s at runtime with
// `Aborted(both async and sync fetching of the wasm failed)` after a clean build.
//
// {@link setHarfBuzzWasmUrl} exists for exactly those hosts: copy `harfbuzz.wasm`
// out of this package, serve it, and point the runtime at it before the first
// editor is created. The build cannot do this part for the consumer, because only
// the consumer knows where their assets are served from.
//
// The loader reads the URL ONCE, at WASM instantiation inside the runtime's first
// import. That is why the setter refuses late calls instead of ignoring them: a
// call after the read would change nothing, silently, and the resulting "it is set
// but not used" is far harder to debug than an immediate error.

let overrideUrl: string | null = null;
let resolvedUrl: string | null = null;

/**
 * Point the text shaper at an externally hosted copy of `harfbuzz.wasm`.
 *
 * Needed only under bundlers that do not emit `new URL(..., import.meta.url)`
 * assets — esbuild and Bun today. There, the build succeeds and the shaper fails
 * at runtime with `Aborted(both async and sync fetching of the wasm failed)`
 * (surfaced as a `HarfBuzzShapingError` with code `wasmUnavailable`); this
 * function is the fix. Webpack, Turbopack and Vite emit the binary on their own,
 * and passing a URL there simply overrides theirs.
 *
 * ```ts
 * import { setHarfBuzzWasmUrl } from '@docx-editor.dev/core/layout';
 * setHarfBuzzWasmUrl('/static/harfbuzz.wasm');
 * ```
 *
 * Call it before the first editor (or {@link initializeHarfBuzz}) so the runtime
 * has not read its location yet; a later call throws rather than being silently
 * ignored. After a failed load in the same session, reload the page — the module
 * cache pins the errored runtime. The file to serve is exported as
 * `@docx-editor.dev/core/dist/harfbuzz.wasm`, and it must be the copy from the
 * installed package version: the runtime refuses a version mismatch at load
 * rather than shaping with unverified metrics.
 *
 * Applies to the ESM build. The CJS build loads harfbuzzjs externally, which is
 * a Node path where the default on-disk location already works.
 *
 * @public
 */
export function setHarfBuzzWasmUrl(url: string | URL): void {
  const next = String(url);
  if (resolvedUrl !== null && resolvedUrl !== next) {
    throw new Error(
      'setHarfBuzzWasmUrl: the HarfBuzz runtime already resolved its binary from ' +
        `${resolvedUrl}. Set the URL before the first editor is created.`
    );
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
  resolvedUrl = overrideUrl ?? bundlerResolvedUrl;
  return resolvedUrl;
}

/** Test seam: forget both URLs so one test's override cannot leak into the next. */
export function resetHarfBuzzWasmUrlForTests(): void {
  overrideUrl = null;
  resolvedUrl = null;
}
