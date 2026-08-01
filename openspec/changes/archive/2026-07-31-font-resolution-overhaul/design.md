# Design — Font Resolution Overhaul

## Context

Shaped measurement is gated on `config.fonts: FontConfiguration` — an immutable,
byte-backed source set sampled once per editor lifetime. `createLayoutShaping`
(`packages/core/src/editor/font-configuration.ts`) validates sources against hard caps,
builds a `FontResourceSnapshot` behind `harfBuzzFontValidator`, initializes HarfBuzz,
and the editor swaps from the fixed measurer to the shaped one via a single
tree-preserving remount (`docx-editor.ts` ~line 290). Three facts shape this design:

- `readEmbeddedFonts` (`store/package/embedded-fonts.ts`) already extracts and
  deobfuscates `word/fontTable.xml` embeds but has no consumer.
- The `FontSource` contract requires `sha256:`-prefixed content hashes;
  `sha256FontBytes` is exported from the font-resource lane.
- Word's default faces are proprietary; metric-compatible OFL substitutes (Carlito,
  Caladea, Liberation) are the only redistributable path to accurate measurement for
  typical documents.

Constraint from the security posture: never fetch a remote resource on document open.

## Goals / Non-Goals

**Goals:**

- Embedded DOCX fonts reach shaped measurement with zero configuration.
- An opt-in package makes Calibri/Cambria/Times/Arial/Courier documents measure
  Word-accurately without the app sourcing font files.
- A supported helper turns app-specified URLs into verified, cached `FontSource`s.
- At most one shaped remount per load regardless of how many font origins resolve.
- Fixed measurer remains the zero-config default and every failure path's landing spot.

**Non-Goals:**

- No engine-initiated network fetch, ever (no default CDN, no Google Fonts).
- No incremental/per-family font resolution during an editing session — the
  configuration stays immutable per mount; changes require remount by design.
- No WOFF2 ingestion in this change (HarfBuzz consumes raw sfnt; a Brotli decoder is a
  follow-up if asset size demands it).
- No rescale-in-place remount that preserves undo/caret (tracked as existing debt).
- No platform/system font access (Local Font Access API is Chrome-only and gated).

## Decisions

### D1 — Merge point: per-load composition inside the editor, not in adapters

Embedded fonts are a property of the *document*, while `config.fonts` is per-editor.
So shaping configuration becomes an internal per-load composition: on `load()`, the
editor reads embedded faces from the package model, merges them with `config.fonts`
sources, and runs `createLayoutShaping` on the merged set. Adapters (React/Vue) keep
passing `fonts` through untouched — parity is free.

*Alternative rejected:* having adapters call `readEmbeddedFonts` and build the merged
config themselves — duplicates logic across adapters and leaks package-model access
into hosts.

### D2 — Mapping embedded faces to `FontSource`

`EmbeddedFont { family, style: regular|bold|italic|boldItalic, bytes }` maps to
`FontFaceRequest` as regular→400/normal, bold→700/normal, italic→400/italic,
boldItalic→700/italic. `hash` is computed with `sha256FontBytes`; `id` is derived from
part name; `faceIndex` is 0. Validation is *not* done at extraction (per the module's
own contract) — merged sources flow through the existing
`createFontResourceSnapshot` + `harfBuzzFontValidator` + hard caps unchanged. A face
the validator rejects is dropped with an `onFontError` report; remaining faces still
admit.

### D3 — Precedence: explicit > embedded > substitution

On family/weight/style collision, `config.fonts` sources win over embedded faces
(the app knows better than the file), and substitutions apply only when no direct
source matches (existing resolver semantics). Substitution lists concatenate:
explicit first, then package-provided (e.g. Calibri→Carlito), first match wins.

### D4 — Zero-config embedded case synthesizes a configuration

When `config.fonts` is absent but the document embeds fonts, the editor synthesizes a
`FontConfiguration`: `epoch` derived from a load counter, `maxFontBytes =
HARD_MAX_FONT_BYTES`, `defaultFont` from the document's theme/docDefaults when
resolvable, else `{ family: 'Calibri', sizeHalfPoints: 22 }` (Word's default). This
keeps `createLayoutShaping`'s validation path single.

### D5 — One remount per load: await composition as a whole

Today `createLayoutShaping` runs once at editor construction. It moves to a per-load
async step that awaits *all* origins (explicit bytes are sync; embedded extraction is
sync; HarfBuzz init is async) and produces one shaped measurer, then performs the one
existing remount. `loadFonts`/`@docx-editor.dev/fonts` resolve *before* the app
constructs the editor (they produce config, they don't talk to the editor), so they
add no remounts.

### D6 — `@docx-editor.dev/fonts`: assets as URLs, helper returns a fragment

New workspace package holding TTF assets (Carlito, Caladea, Liberation Serif/Sans/Mono
— regular/bold/italic/boldItalic each) referenced via `new URL(..., import.meta.url)`
so bundlers fingerprint and serve them as separate lazily fetched files; the JS entry
stays tiny and core takes no dependency on it. Public helper:

```ts
loadDefaultFonts(options?: { families?: WordDefaultFamily[] }): Promise<FontConfigurationFragment>
```

returning `{ sources, substitutions }` with precomputed `sha256:` hashes (baked at
build time, verified in CI) and the substitution map (Calibri→Carlito,
Cambria→Caladea, Times New Roman→Liberation Serif, Arial→Liberation Sans, Courier
New→Liberation Mono). Loading the app's *own* bundled assets on mount is not a
zero-click external fetch — the app opted in by installing and calling. OFL license
texts ship inside the package. The package joins the fixed-version release group.

*Alternative rejected:* baking assets into core (size; most consumers never need
them) and base64-embedding in JS (double size, no streaming, no HTTP cache).

### D7 — `loadFonts` fetch+cache helper lives in core

```ts
loadFonts(request: {
  sources: ReadonlyArray<{ url: string; family: string; weight: number;
    style: 'normal' | 'italic'; hash?: string; faceIndex?: number }>;
  cacheName?: string;                  // Cache API bucket; default 'docx-editor-fonts'
  fetcher?: typeof fetch;              // injectable for tests/CSP
}): Promise<{ sources: FontSource[]; failures: FontLoadFailure[] }>
```

- Fetches only the URLs given — the caller chose them; nothing implicit.
- Computes `sha256FontBytes` on the response; if `hash` was supplied and mismatches,
  that source fails hard (cache-poisoning guard) and is reported, not admitted.
- Caches via the Cache API keyed by URL, revalidated by content hash on read;
  degrades to no-cache where Cache API is unavailable (non-secure context, Node).
- Never throws for per-source failures: returns admitted sources plus typed
  failures so the app can proceed on the fixed measurer and report.

Core placement (not the fonts package) because it is generic plumbing over the
existing hash/contract machinery and the fonts package must stay asset-only + thin.

### D8 — Composition helper is public

`composeFontConfiguration(base, ...fragments): FontConfiguration` — merges fragment
sources/substitutions under D3 precedence, computes `epoch`, applies default
`maxFontBytes`/`defaultFont` when absent. Exported from core so the three origins
compose in one documented way:

```ts
const fonts = composeFontConfiguration(
  { defaultFont: { family: 'Calibri', sizeHalfPoints: 22 } },
  await loadDefaultFonts(),
  await loadFonts({ sources: brandFontUrls }),
);
createDocxEditor({ fonts }); // embedded faces still auto-merge per-load underneath
```

## Risks / Trade-offs

- [Embedded fonts are attacker-controlled] → No new surface: extraction asserts
  nothing; admission stays behind `harfBuzzFontValidator` and the existing hard caps
  (`HARD_MAX_FONT_BYTES` 64 MiB/face, 256 sources, 128 MiB aggregate). Per-face
  rejection degrades that face only.
- [Undo stack + caret lost on the shaped remount] → Pre-existing, documented cost;
  unchanged frequency (once per load). Rescale-in-place stays future work.
- [Fonts package asset weight (~15 faces × ~0.3–0.9 MB TTF)] → Separate fingerprinted
  assets, fetched lazily only for requested families; transport compression is the
  host's; `families` option narrows further. CI check guards JS-entry size.
- [Hash drift when substitute fonts are updated] → Hashes are build-time generated
  from the shipped bytes and CI-verified; a font update regenerates hashes in the
  same commit.
- [Cache API unavailability / eviction] → Helper treats cache strictly as an
  optimization; a miss or eviction refetches; absence degrades to direct fetch.
- [Per-load shaping rebuild cost on repeated `load()`] → Snapshot admission is
  hash-keyed; unchanged byte sets re-admit cheaply. Measured in the perf gate before
  merge.
- [Metric compatibility is close, not perfect] → Advance widths match; rare kerning
  differences can shift a wrap point versus real Calibri. Documented honestly in the
  fonts guide; apps needing exactness supply licensed bytes via `loadFonts`.

## Open Questions

- Should `getDocumentFonts()` gain a companion reporting *resolution status* per
  family (embedded / explicit / substituted / fixed-fallback) for host UI badges?
  Leaning yes but as a follow-up surface.
- Do we surface a `defaultFont` derivation from the document's `docDefaults`/theme in
  this change, or hardcode the Calibri/22 fallback and follow up? (Design assumes
  derive-when-cheap, fall back otherwise.)
- WOFF2 assets for the fonts package (≈40% smaller) once a Brotli decode path is
  acceptable — follow-up change.
