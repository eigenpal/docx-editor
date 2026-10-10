# Tasks — Font Resolution Overhaul

## 1. Composition foundation (core)

- [x] 1.1 Add `FontConfigurationFragment` type and `composeFontConfiguration(base, ...fragments)` to core contracts: D3 precedence (explicit > embedded > substitution), epoch derivation, `maxFontBytes`/`defaultFont` defaults; unit tests for collision, substitution concat order, and frozen output
- [x] 1.2 Refactor `docx-editor.ts` shaping from construction-time to per-load: build merged configuration inside `load()`, keep single tree-preserving remount, pre-resolution edits survive; test one-remount-per-load with both origins present
- [x] 1.3 Regression: zero-config + no embedded fonts stays on fixed measurer with no font work and no errors

## 2. Embedded font auto-wiring (core)

- [x] 2.1 Map `readEmbeddedFonts` output to `FontSource[]`: style-slot → weight/style mapping, `sha256FontBytes` hash, id from part name, faceIndex 0
- [x] 2.2 Wire embedded sources into per-load composition; synthesize `FontConfiguration` in the zero-config case (epoch from load counter, `defaultFont` from docDefaults when cheap else Calibri/22)
- [x] 2.3 Per-face degradation: validator-rejected or over-cap embedded faces drop with typed `onFontError`, remaining faces admit; corrupt fontTable never blocks `load()`
- [x] 2.4 Precedence tests: explicit source beats embedded same-face; embedded beats substitution; bold-italic slot resolves bold+italic runs
- [x] 2.5 Fixture: small DOCX embedding an OFL face (regular + boldItalic, one intentionally corrupt part variant); assert shaped measurement engages end-to-end on load

## 3. loadFonts helper (core)

- [x] 3.1 Implement `loadFonts` per D7: explicit URL list only, injectable fetcher, per-source typed failures, never-reject contract
- [x] 3.2 Hash gating: computed `sha256:` attached when no expectation; mismatch → hard per-source failure with expected/actual hashes
- [x] 3.3 Cache API layer: bucket `docx-editor-fonts`, keyed by URL, hash-revalidated on read, poisoned entry discarded and refetched, graceful no-cache degradation (Node/non-secure context)
- [x] 3.4 Tests: two-URL exactness (no extra requests), 404-of-three partial admission, second-call cache hit, tampered-cache refetch

## 4. @docx-editor.dev/fonts package

- [x] 4.1 Scaffold `packages/fonts` workspace package: tsconfig, build, exports map, fixed-version release group membership, OFL license texts for Carlito/Caladea/Liberation
- [x] 4.2 Add TTF assets (5 families × 4 faces) referenced via `new URL(..., import.meta.url)`; build step computes and bakes `sha256:` hashes
- [x] 4.3 Implement `loadDefaultFonts(options?)`: family narrowing, lazy asset fetch, returns `{ sources, substitutions }` with the Word-name → substitute map
- [x] 4.4 CI checks: baked hashes match shipped bytes; JS entry contains no inlined font bytes (size guard); no core → fonts import (lane boundary)
- [x] 4.5 Tests: Calibri→Carlito substitution resolves through a composed configuration; `families` narrowing fetches only requested assets; no fetch without a call

## 5. Adapters, demo, and parity

- [x] 5.1 Confirm React and Vue adapters pass `fonts` through unchanged post-refactor; add parity-contract entries if the prop surface changed
- [x] 5.2 Opt the vite (React) and Vue demos into `loadDefaultFonts()` composition; verify in-browser that a Calibri/Times demo document engages shaped measurement (no fixed-measurer fallback for covered families)
- [x] 5.3 Perf gate: repeated `load()` with unchanged byte sets re-admits via hash cheaply; record numbers against the pre-change baseline

## 6. Public surface and docs

- [x] 6.1 Tag new public symbols (`composeFontConfiguration`, `loadFonts`, fragment types, fonts-package exports); `bun run api:extract`; commit snapshots including the new `docs/api/` entry for the fonts package
- [x] 6.2 Fonts guide in `docs/site/content/` (three sources, composition example, metric-compatibility honesty note, security stance on fetching); register the page in BOTH the root `meta.json` and the subfolder `meta.json`
- [x] 6.3 Update `docs/site/data/word-features.ts` for font-measurement support claims
- [x] 6.4 Changeset: minor bump (additive public API), consumer-facing summary

## 7. Validation

- [x] 7.1 `bun run typecheck` and targeted test runs for touched suites (layout shaping, font-resource, editor load, new packages)
- [x] 7.2 Security audit grep from CLAUDE.md on the diff; confirm no zero-click fetch path exists from `load()` and embedded bytes stay behind validator + caps
- [x] 7.3 `bun run check:parity` + `check:lane-boundaries` + i18n validate (if any user-facing strings were added)
