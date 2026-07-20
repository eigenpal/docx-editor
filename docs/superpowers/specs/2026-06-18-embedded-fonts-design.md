# Embedded font rendering + document-aware font picker

## Problem

A DOCX can carry its own fonts in `word/fonts/*.odttf`. We unzipped those
binaries and preserved them on save, but never **rendered** them: `fontTable.xml`
was not parsed, the obfuscated `.odttf` bytes were never de-obfuscated, and
nothing registered them with the browser. Documents authored in a proprietary
font fell back to a metric-compatible substitute. Separately, the font picker
only ever showed a fixed 12-font list, so fonts the document actually uses were
not selectable even when the system could render them.

## Scope (agreed)

- **Render only.** De-obfuscate + load embedded faces so opened docs display in
  their authored fonts. Round-trip preservation already works via
  `originalBuffer`; no write-side embedding.
- **Auto, on by default.** No activation prop. No-op when a file embeds no fonts
  or outside a DOM (headless/SSR).
- **Ignore `fsType`.** A WYSIWYG editor showing the page is "preview"; we do not
  gate on OS/2 embedding-permission bits.
- **Picker:** surface a font the document references only when it will truly
  render (embedded, or `canRenderFont()` says the system has it), shown under a
  separate **Document fonts** group, deduped against the built-in list.

## Architecture (core-centric)

All logic lives in `packages/core` as pure, tested utilities; the React and Vue
adapters are thin wiring.

| Piece                                             | File                           |
| ------------------------------------------------- | ------------------------------ |
| De-obfuscation (GUID-XOR, ECMA-376 §2.8.1)        | `utils/fontDeobfuscation.ts`   |
| Parse `fontTable.xml` (+ `w:fontKey`, embed rels) | `docx/fontTableParser.ts`      |
| Resolve + de-obfuscate + load faces               | `utils/embeddedFonts.ts`       |
| Picker discovery (embedded ∪ system-resolvable)   | `utils/documentPickerFonts.ts` |

Wiring:

- `parseDocx` parses the font table into `pkg.fontTable` and, in the existing
  font-load stage, calls `loadEmbeddedFonts(...)` (browser-guarded). This gives
  React, Vue, and headless the same behavior with no adapter duplication.
- `FontInfo` embed fields change from `string` to `FontEmbed { relId, fontKey,
subsetted }` (previously unused, so safe). `loadFontFromBuffer` gains a
  `style: 'italic'` option for italic faces.
- Each adapter's document-load path computes
  `getRenderableDocumentFonts(doc, { embeddedFamilies })` and threads the result
  to the picker as an internal `documentFonts` prop. The picker renders a
  "Document fonts" group (`font.documentFonts` i18n key).

## De-obfuscation algorithm

The first 32 bytes of an `.odttf` are XOR-scrambled with the 16 `w:fontKey` GUID
bytes in **reversed** order, applied to bytes 0-15 then 16-31; the rest is
untouched OpenType. Pure XOR, so the same op obfuscates and de-obfuscates.

## Testing

- Unit: `deobfuscateFont` (direction pinned against the spec's own example
  vector), `parseFontTable`, `getEmbeddedFontFaces`, `selectRenderableFonts`.
- Integration: a real in-memory `.docx` with an embedded obfuscated font run
  through `parseDocx` — asserts `pkg.fontTable`, end-to-end de-obfuscation to a
  valid sfnt header, and round-trip binary preservation.
- Adapter wiring is typechecked in both React and Vue; parity + API snapshots
  updated.

## Out of scope / follow-ups

Write-side font embedding, `fsType` enforcement, lazy/on-demand loading, and a
browser e2e fixture (a real obfuscated font binary) for the picker group.
