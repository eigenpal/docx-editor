# @docx-editor.dev/fonts

## 2.15.1

### Patch Changes

- 1acd366: Stop `FONT_ASSET_ROOT` from throwing at module scope under webpack and Turbopack, which
  took down the whole client bundle of any app that imported this package.

  Those bundlers replace `new URL('../assets/<face>', import.meta.url)` with a bare
  relative path string for the asset they emitted. Deriving the asset root from one entry
  with a single-argument `new URL()` therefore threw `URL constructor:
/_next/static/media/Caladea-Bold.<hash>.ttf is not a valid URL` while the module was
  still evaluating, where nothing can catch it.

  In a bundled build the root now reports a non-`file:` URL, which is what consumers
  already gate on before using it as a `createPackagedFileFetch` trusted root. That holds
  even when the page itself was opened from disk, as in an Electron renderer or a static
  export: the bundler moved the faces, so no local directory holds them, and a bundle
  serving assets from the path root would otherwise have resolved to the filesystem root,
  which `createPackagedFileFetch` rejects by throwing.

  Two ways a packaged face could silently fail to register are also fixed. The `FontFace`
  URL source read `.href` off the bundler's string, which is `undefined`, emitting the
  literal `url(undefined)`. And the source was unquoted, so an install path containing
  characters an unquoted CSS `url()` token forbids, parentheses among them, produced a
  token the browser could not parse.

## 2.15.0

### Minor Changes

- 0d81033: Export `FONT_ASSET_ROOT` so hosts can confine packaged-font reads to the fonts package without guessing its install path.

### Patch Changes

- 5284df5: Preserve one literal asset URL per packaged font face in the ESM browser build so Next.js with
  Turbopack, Vite, and webpack resolve every requested filename instead of collapsing dynamic URLs
  to one font. Keep the CommonJS build resolving the same packaged files in Node.

## 2.14.1

### Patch Changes

- 65e146c: Preserve one literal asset URL per packaged font face in the ESM browser build so Next.js with
  Turbopack, Vite, and webpack resolve every requested filename instead of collapsing dynamic URLs
  to one font. Keep the CommonJS build resolving the same packaged files in Node.

## 2.14.0

## 2.13.0

### Minor Changes

- 0860dd2: Match Word's widths and per-weight line box for documents that name Century Gothic, served on demand from the bundle by `googleFonts()`; `loadDefaultFonts()` and `defaultFonts()` now default to `WORD_DOCUMENT_DEFAULT_FAMILIES`, so `ALL_WORD_DEFAULT_FAMILIES` becomes an explicit opt-in that loads four more faces than before. Fixes #507.
- 48cc3f7: Add `packagedFonts()`, which serves the bundled Word substitutes on demand so a document loads the families it names plus its default face, rather than every face of Word's five document defaults, and give `useFonts` and `useDocxSource` one uniform origin list where order is precedence. `defaultFonts()` keeps working unchanged.

### Patch Changes

- 41952f2: Register a packaged face from the bytes already loaded, so it costs no second request and an injected `fetcher` sees every byte read for it. A face that fails to load still registers by URL. Fixes #596.

## 2.12.0

## 2.11.0

## 2.10.0

## 2.9.2

## 2.9.1

## 2.9.0

## 2.8.0

## 2.7.0

## 2.6.1

## 2.6.0

## 2.5.0

## 2.4.1

## 2.4.0

## 2.3.1

## 2.3.0

## 2.2.1

## 2.2.0

## 2.1.3

## 2.1.2

## 2.1.1

## 2.1.0

## 2.0.1

## 2.0.0
