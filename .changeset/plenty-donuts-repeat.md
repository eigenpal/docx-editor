---
'@docx-editor.dev/fonts': patch
---

Stop `FONT_ASSET_ROOT` from throwing at module scope under webpack and Turbopack, which
took down the whole client bundle of any app that imported this package.

Those bundlers replace `new URL('../assets/<face>', import.meta.url)` with a bare
relative path string for the asset they emitted. Deriving the asset root from one entry
with a single-argument `new URL()` therefore threw `URL constructor:
/_next/static/media/Caladea-Bold.<hash>.ttf is not a valid URL` while the module was
still evaluating, where nothing can catch it. In a bundled build the root now reports a
non-`file:` URL, which is what consumers already gate on before using it as a
`createPackagedFileFetch` trusted root.

Registering a packaged face by URL no longer reads `.href` off that same string, which
had been producing the literal source `url(undefined)` and silently losing the face.
