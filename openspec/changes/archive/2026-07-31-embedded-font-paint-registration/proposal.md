# Embedded Font Paint Registration

## Why

Embedded fonts already drive Word-accurate measurement (line wrap, pagination),
but the painted pages are ordinary DOM: without a browser `@font-face`
registration for the same bytes, a font that exists only inside the DOCX renders
in whatever the platform substitutes. Layout is right while pixels are wrong —
the document is not visually self-contained.

## What Changes

After embedded faces pass validation and admit into the shaped measurer, the
editor registers the same bytes on the environment's `FontFaceSet`
(`document.fonts`) under the embedded family name, and removes them when the
document is replaced or the editor is destroyed. Registration is best-effort
presentation fidelity: it never affects measurement, never blocks or fails a
load, and no-ops outside a DOM environment. Only faces the validator admitted
are registered; family names are CSS-escaped before reaching the `FontFace`
constructor.

No public API changes: the behavior is automatic, internal to the editor
lifecycle, and scoped to embedded faces (explicit app-supplied sources remain
the app's responsibility, matching `installDefaultFontFaces` for the substitute
package).

## Impact

- `packages/core/src/editor/`: new internal registration module; wiring in
  `resolveDocumentFonts`, per-load reset, and `destroy()`.
- Spec delta: one ADDED requirement on `embedded-font-autowire`.
- Docs: fonts guide paragraph on paint-side behavior for embedded faces.
