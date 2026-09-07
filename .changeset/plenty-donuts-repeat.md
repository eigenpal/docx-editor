---
'@docx-editor.dev/fonts': patch
---

Stop `FONT_ASSET_ROOT` from throwing at module scope under webpack and Turbopack, which
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
