# Font Resolution Overhaul

## Why

Shaped (HarfBuzz) measurement only runs when the host app hands `createDocxEditor` a
fully materialized `FontConfiguration` of raw font bytes. Nobody does this by default —
the flagship demo included — so the common case is the fixed (monospace) measurer:
glyphs paint in their real faces but wrap and pagination points are estimated rather
than Word-accurate. The engine already extracts embedded DOCX fonts
(`readEmbeddedFonts`) but never feeds them to layout, and there is no supported path to
obtain bytes for the fonts most documents actually use (Calibri, Times New Roman, …),
which are proprietary and cannot be bundled.

## What Changes

- **Auto-wire embedded DOCX fonts.** When a loaded package embeds fonts, the editor
  builds (or extends) the shaped-measurement font set from those deobfuscated bytes
  automatically — no config, no assets, no network. Explicit `config.fonts` sources
  take precedence over embedded faces on family/weight/style collision.
- **New `@docx-editor.dev/fonts` companion package.** Ships metric-compatible libre
  substitutes for Word's default faces (Carlito→Calibri, Caladea→Cambria, Liberation
  Serif/Sans/Mono→Times New Roman/Arial/Courier New; OFL-licensed) as lazily loaded
  assets plus a helper that returns a ready `FontConfiguration` fragment including the
  matching `substitutions` entries. Opt-in, one line for consumers; core stays slim.
- **`loadFonts` fetch+cache helper.** Fetches app-specified font URLs (app-hosted or a
  CDN the app chooses — never an engine default), verifies against `sha256:` content
  hashes, caches locally keyed by hash, and produces `FontConfiguration` sources.
  Explicit opt-in only: the engine never fetches on open (no zero-click external
  fetch, per the security posture).
- **Composition.** All three sources merge into one immutable `FontConfiguration`
  sampled per mount; the existing async-resolve → single tree-preserving remount
  lifecycle is reused unchanged. The fixed measurer remains the zero-config default
  and the resilience fallback when resolution or fetch fails.

## Capabilities

### New Capabilities

- `embedded-font-autowire`: Embedded DOCX fonts flow into shaped measurement
  automatically on load, with validation, size caps, and precedence rules against
  explicitly configured sources.
- `default-font-substitutes`: The `@docx-editor.dev/fonts` package — metric-compatible
  substitute faces, their substitution map, lazy asset loading, and the helper that
  yields a `FontConfiguration` fragment.
- `font-fetch-cache`: The `loadFonts` helper — explicit URL map in, hash-verified and
  cached bytes out, with typed failure reporting that degrades to the fixed measurer.

### Modified Capabilities

<!-- No existing spec's requirements change. Font behavior is currently unspecified at
     spec level; the editor-config `fonts` contract is additive (optional prop stays
     optional, byte-source shape unchanged). -->

## Impact

- `packages/core/src/editor/docx-editor.ts` — merge embedded faces into the shaping
  configuration built at load; precedence and remount flow.
- `packages/core/src/editor/font-configuration.ts` — accept merged multi-origin
  sources; keep hard caps (`HARD_MAX_FONT_BYTES` et al.) authoritative.
- `packages/core/src/store/package/embedded-fonts.ts` — already exists; gains a
  consumer. Validation stays in the font-resource lane, not here.
- New workspace package `packages/fonts` (`@docx-editor.dev/fonts`) — added to the
  fixed-version release group, changesets, API Extractor snapshot, parity checks.
- New core helper (exported from core) for `loadFonts`; uses the existing
  `sha256FontBytes` hash format.
- Public API surface: `docs/api/` snapshots for core (new helper) and the new
  package; `docs/site/` feature-support matrix and a fonts guide.
- Demo apps (`examples/vite`, `examples/vue`) opt into the substitute package so the
  flagship demo measures Word-accurately.
- No breaking changes: `fonts?: FontConfiguration` keeps its shape; zero-config
  behavior (fixed measurer) is preserved.
