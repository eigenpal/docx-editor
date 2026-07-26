# Document engine technology selection

**Status:** Accepted selection policy; named candidates remain milestone-gated
**Date:** 2026-07-22
**Authority:** `document-engine/design.md`, capability specifications, and
`tasks.md`

## Purpose

The engine owns DOCX semantics, deterministic layout, preservation, and
conformance. It MUST NOT reimplement mature infrastructure merely to avoid a
dependency. This record distinguishes dependencies already selected by the
architecture from candidates that require evidence before selection and from
functionality that must never be hand-rolled.

A candidate becomes selected only when its owning milestone records:

- exact package and pinned version;
- license and redistribution review, including transitive and WASM/native
  artifacts;
- browser, worker, and server runtime support;
- deterministic behavior and versioned output fingerprints;
- security posture for attacker-controlled DOCX, XML, fonts, images, and wire
  input;
- bounded-memory, cancellation, performance, and bundle-size evidence;
- fallback, upgrade, migration, and conformance strategy.

Package selection does not transfer engine semantics to a dependency. Runtime
ports, trust boundaries, authored-state ownership, operation semantics,
resource limits, and conformance remain engine responsibilities.

## Selected dependencies and mechanisms

### Text shaping (HarfBuzz Task 4 slice) — SELECTED WITH LIMITATIONS

The shaping bake-off selects `harfbuzzjs@1.4.0` (HarfBuzz `14.2.1`) as the
production OpenType shaper in `@docx-editor.dev/engine-layout`. `fontkit` is not
retained for shaping or metric access: the current HarfBuzz class API supplies
glyph selection, clusters, OpenType features, advances, horizontal metrics, and
face-table inspection needed by this slice. `fontkit` remains an unevaluated
candidate for later PDF embedding/subsetting work only.

- **Package and version:** exact `harfbuzzjs@1.4.0`, with no runtime
  dependencies. The npm package reports 1,023,657 unpacked bytes across nine
  files. Its production shaping artifacts are 57,714 bytes of class API,
  26,687 bytes of Emscripten loader, and 390,365 bytes of WASM.
- **License / redistribution:** `harfbuzzjs` is MIT-licensed. The conformance
  fonts are unmodified DejaVu Fonts 2.37 regular and bold TTFs from the
  authoritative upstream release. Their exact upstream license, attribution,
  source URL, and SHA-256 digests are retained in
  `packages/engine-layout/test/fixtures/fonts/`.
- **Bundle evidence:** Vite 8.0.10 with `target: es2022` and ESM worker output
  emits one 390.36 kB shaping WASM asset (163.89 kB gzip). The smoke's main
  JavaScript chunk is 160.68 kB (47.98 kB gzip), its shared-source chunk is
  147.79 kB, and its worker/parity entry chunks total 1.52 kB before
  compression. The raw class API and WASM gzip to
  12,653 and 160,411 bytes respectively. The npm package also contains an
  unused 507,610-byte subset WASM artifact; the production smoke does not emit
  it.
- **Runtime loading and parity:** Bun server and module-worker tests load the
  packaged WASM with no filesystem path supplied by the caller. A production
  Chromium run of the Vite bundle shapes the same LTR positioned-mark and RTL
  Arabic fixtures in the browser main thread and a module worker. A Bun
  server-generated, committed canonical golden carries the pinned
  library/version, full environment fingerprint, and exact runtime comparator:
  text, direction, script/language, bidi level, every glyph ID/UTF-16
  cluster/advance/offset, every cluster range/advance/caret edge/font-span
  index, vertical metrics, and font-span identity, byte-hash provenance,
  substitution, and fallback index. Chromium main and worker each compare their
  canonical JSON byte-for-byte to that same golden; both passed with no console
  errors. The Vite worker must use ESM output because `harfbuzzjs`
  initializes through top-level await; the default IIFE worker build rejects
  that syntax. `test/fixtures/vite.config.ts` records the required deployable
  setting.
- **Server runtime evidence:** on Apple M4 Pro, Bun 1.3.14, the 757,076-byte
  regular fixture took 162.445 ms for hash/resource validation, 3.680 ms for
  first shaping, and 0.039 ms median / 0.097 ms p95 across 1,000 warm shapes of
  `office AV á سلام`. These are development-build measurements, not release
  performance budgets.
- **Exact output:** `harfbuzz-shaper.test.ts` records literal glyph IDs,
  UTF-16 clusters, advances, offsets, vertical metrics, kerning, `liga` on/off,
  positioned combining-mark behavior (`x` + U+0301 yields mark glyph 690 with
  zero advance and fixed-point `offsetX = -34`), explicit
  RTL/Arabic/language input, true regular and bold face output, all three
  fixed-point tie rules, and repeated exact comparator equality. The shaper
  processes a complete input span in one HarfBuzz buffer.
- **Fixed-point policy:** font-unit values are converted to fixed-point points
  as the exact rational
  `fontUnits * fontSizeHalfPoints * fixedPointScale / (2 * unitsPerEm)`.
  BigInt quotient/remainder arithmetic implements `halfAwayFromZero`,
  `halfToEven`, and `towardZero` without floating-point ties.
- **Security and bounds:** font bytes are copied at the resource boundary and
  hash-bound to face identity. Bounded sfnt range and required-table checks run
  there without constructing native HarfBuzz objects; native HarfBuzz metrics
  validation runs once when the face enters the shaper cache. The shaper reads
  owned `byteLength` and enforces its 16 MiB default before requesting a
  defensive byte copy. Independent pre-shape ceilings default to 1,000,000
  UTF-16 code units and 1,000,000 Unicode code points; both are checked before
  and after normalization. `maxGlyphs` remains a typed 1,000,000-glyph
  postcondition only. The `harfbuzzjs` class API cannot enforce a caller-defined
  native output-allocation ceiling before `shape()` returns, so `maxGlyphs`
  does not bound peak native allocation. Peak native memory during shaping is
  bounded only by the pinned WASM module and host runtime, not by an
  engine-supplied output limit. All configurable ceilings must be positive safe
  integers. Over-limit text/font/input/output, malformed fonts, color-font
  tables, variation requests, unevidenced fallback order, version mismatch,
  and use after disposal are typed failures.
- **Variable and color policy:** this slice rejects every non-empty variation
  axis request as `unsupportedVariationAxes`; no default instance is silently
  substituted. Fonts advertising `COLR`, `CPAL`, `CBDT`, `CBLC`, `sbix`, or
  `SVG ` tables are rejected as `unsupportedColorFont`; no monochrome
  degradation is silent.
- **Lifecycle limitation:** the 1.4.0 class API registers Blob, Face, Font, and
  Buffer pointers with `FinalizationRegistry`; source and prototype inspection
  found no public `destroy()`/`dispose()` method. The shaper therefore reuses
  one buffer and an explicit LRU face/font/blob cache (four faces by default,
  with a validated positive safe-integer ceiling). Observable cache
  instrumentation verifies creation, MRU promotion, least-recent eviction, and
  recreation after eviction; valid cache admission performs no duplicate native
  validation allocation. `HarfBuzzTextShaper.dispose()` clears reachable
  cache/buffer references and prevents reuse, but it does not synchronously
  destroy WASM pointers. Evicted entries and malformed admission attempts
  remain collector-timed; total pending native memory is not claimed to be
  bounded. The lifetime gate remains open.
- **Still open:** fallback selection across multiple fonts, variable-font
  shaping, color-font painting policy, Unicode bidi/UAX #14 selection,
  cancellation, a caller-enforced pre-shape native output-allocation ceiling,
  release-mode benchmark budgets, bundle acceptance, and explicit WASM pointer
  destruction remain unevidenced. The lifetime/bundle/native-allocation gates
  and broad document-engine task 8.1 remain open.

### Yjs collaboration primitives

- `yjs` is the selected collaborative backend family.
- `Y.UndoManager` is selected for actor/session-scoped collaborative undo over
  eligible tracked local origins, composed with engine-owned validation,
  normalization, grouping, identity restoration, notifications, persistence,
  and lifecycle rules.
- `Y.RelativePosition` is selected for private edit-surviving text positions in
  the Yjs backend. Public APIs expose only opaque `AnchorHandle`s; trusted
  backend, awareness, and persistence envelopes carry versioned,
  document-bound encodings. The local backend must provide behaviorally
  equivalent anchors without exposing a Yjs type.
- `y-protocols/awareness` is selected for ephemeral collaborative presence and
  cursor/selection state. Authentication, authorization, rate limits, payload
  bounds, lease/expiry policy, opaque anchor envelopes, and strict exclusion
  from authored state, snapshots, history, undo, DOCX, and audit replay remain
  engine/server responsibilities.

The implementation milestones still pin exact compatible versions and prove
the shared backend, anchor, undo, and awareness conformance suites.

### ZIP and XML package reader (task 1.3) — SELECTED

The bake-off is resolved. The production package reader uses `fflate` for
bounded ZIP and `fast-xml-parser` for XML, each behind the engine's bounded
trust boundary. `JSZip` and the custom spike tokenizer under
`packages/core/spike/` remain non-production POC choices and are not imported by
production modules.

- **Packages and pinned versions:** `fflate@^0.8.2` (resolved 0.8.3) and
  `fast-xml-parser@^4.5.0` (resolved 4.5.7), both direct dependencies of
  `@docx-editor.dev/engine-core`.
- **License / redistribution:** both MIT. `fflate` has zero runtime
  dependencies; `fast-xml-parser`'s only transitive dependency is `strnum`
  (MIT). No WASM or native artifacts, so no additional redistribution review.
- **Runtime support:** pure-ESM, dependency-light, and runtime-agnostic — they
  run identically in browser, worker, and server (Node/Bun) with no DOM, native
  addon, or platform ICU requirement.
- **Determinism and lexical fidelity:** `readZip`/`writeZip`
  (`package/zip.ts`) produce a deterministic archive; the XML reader
  (`package/xml-reader.ts`) returns an ordered, null-prototype-friendly tree that
  preserves significant child order, attributes, whitespace, and raw lexical
  values with `parseTagValue`/`parseAttributeValue` coercion disabled, so no
  file-supplied value is numerically or boolean-coerced.
- **Security posture (attacker-controlled input):** the reader pre-rejects
  DTDs, entity declarations, and external-entity references before parsing
  (`fast-xml-parser` can otherwise process DOCTYPE/entities), leaves the five
  predefined entities and numeric refs to be decoded explicitly (no
  entity-expansion), and rejects `__proto__`/`constructor`/`prototype` keys. ZIP
  reads enforce an entry-count ceiling, a total-uncompressed-size ceiling, and a
  per-entry compression-ratio ceiling BEFORE inflation (zip-bomb guard), and
  normalize every entry name through the OPC profile, rejecting traversal /
  backslash / encoded / case-folded-duplicate names before the bytes are handed
  on. XML written back on save is escaped (`escapeXml`), never templated raw.
- **Bounded / measurable resource limits:** `DEFAULT_ZIP_LIMITS`
  (`maxEntries: 10_000`, `maxTotalBytes: 512 MiB`, `maxRatio: 200`) are explicit,
  overridable per call, and enforced during iteration; the XML reader caps input
  bytes (`maxBytes`) and recursion depth (`MAX_DEPTH = 256`) so hostile nesting
  fails closed instead of overflowing the stack.
- **Evidence:** `test/malicious-conformance.test.ts` (zip bomb by size and by
  ratio, path traversal, case-folded OPC duplicate, DTD/XXE/billion-laughs, deep
  nesting bound, XML injection on save, prototype pollution),
  `test/xml-reader.test.ts` (trust-boundary rejections + fidelity preservation),
  and `test/xml-entities-audit.test.ts` (predefined-entity decode, no
  double-escape round-trip, bounded deep-XML).
- **Ownership boundary:** selecting these packages does not move engine
  semantics into them. Bounded OPC rules, part/relationship ownership,
  preservation capsules, entity policy, and all resource accounting remain
  engine-owned; `fflate`/`fast-xml-parser` provide only the inflate/deflate and
  raw-token/tree primitives behind that boundary.

## Candidates requiring bake-offs

### Text shaping and fonts

The HarfBuzz Task 4 slice is selected above. The remaining bake-off covers
licensed fallback selection, variable/color support beyond typed rejection,
Unicode integration, cancellation, lifecycle improvements, and any later
`fontkit` use for PDF embedding or subsetting. Neither dependency owns
pagination or the `ShapingEnvironment` contract.

### Unicode segmentation, bidi, and line breaking

Evaluate maintained Unicode bidi and UAX #14 line-breaking libraries together
with `Intl.Segmenter` for grapheme segmentation. The selection must pin Unicode
data/version behavior and prove identical grapheme, bidi-level, line-break,
caret, and extraction fixtures in every supported runtime. If runtime ICU data
cannot satisfy deterministic parity, use a pinned-data implementation behind
the same port.

### ZIP and XML

Resolved and SELECTED — see "ZIP and XML package reader (task 1.3)" under
"Selected dependencies and mechanisms" above (`fflate` + `fast-xml-parser`
behind the bounded trust boundary).

### Native PDF

Evaluate `pdf-lib` and `pdfkit`, with `fontkit` where needed for embedding or
subsetting. The bake-off must cover positioned glyph emission from the display
list, transforms, clipping, images, internal and sanitized external links,
font embedding/subsetting, deterministic semantic inspection, `ActualText`,
tagged PDF structure, PDF/UA-1 validation, streaming, browser-free server
execution, and licensing. A library that writes PDF objects does not own
reading order, accessibility semantics, or geometry.

### Schema-first IDL and runtime validation

Evaluate TypeBox plus AJV as the direct JSON-Schema-first candidate. Evaluate
Zod only if one canonical source can still emit stable JSON Schema consumed by
AJV and generate identical `DocOp`, command/query, `DocxEditor.*`, MCP, RPC,
and language-binding schemas without parallel handwritten definitions.

The bake-off must prove closed runtime validation, stable schema hashes,
versioning, code generation, hostile accessor/object handling, diagnostics,
tree shaking, and TypeScript ergonomics.

### RPC and generated clients

Evaluate Connect, gRPC, and OpenAPI tooling for versioned RPC schemas,
streaming/cancellation, bounded binary values, browser and server transports,
and generated TypeScript/Python clients. The selected tooling must preserve the
common `DocxEditor.Result` taxonomy and schema hashes and must not move package
parsing, semantic normalization, layout, or serialization into clients.

### Yjs persistence adapters

Evaluate `y-indexeddb` for browser/offline persistence and `y-leveldb` for
server or local durable storage behind the persistence port. The bake-off must
cover atomic snapshots, update logs, compaction races, migrations, crash
recovery, tenant/document isolation, lifecycle cleanup, schema/version
metadata, and actor-local undo retention. These adapters do not replace the
engine's persistence, compaction, and recovery coordinator.

## Functionality that must never be hand-rolled

Production implementation MUST use reviewed standards implementations for:

- OpenType text shaping and general font parsing/metric/subsetting primitives;
- Unicode bidi, UAX #14 line breaking, and grapheme segmentation;
- ZIP compression/decompression and generic XML tokenization/entity handling;
- low-level PDF container writing and font embedding/subsetting;
- JSON Schema validation and routine schema/client code generation;
- RPC framing, streaming protocol machinery, and language-client generation;
- Yjs collaborative undo transformation, relative-position survival, and
  awareness state clocks/protocol;
- general durable key/value storage primitives used by Yjs persistence.

Engine code still owns the product-specific layers around those primitives:
bounded OPC rules, XML ownership and preservation capsules, canonical authored
state, semantic operations, DOCX structural repair, anchor affinity and
collapse/detach policy, deterministic shaping inputs and fixed-point rounding,
line composition, pagination, display-list geometry, tagged-PDF semantics,
authorization, resource accounting, persistence coordination, and conformance.

## Milestone ownership

- Sections 0 and 7 select schema/validation tooling.
- Sections 1–3 select ZIP/XML tooling (task 1.3: `fflate` + `fast-xml-parser`,
  selected) and preservation integration.
- Sections 4–6 implement the selected Yjs undo and relative-position mechanisms.
- Section 8 selects shaping/font, Unicode, and PDF tooling.
- Section 10 integrates selected awareness and persistence adapters.
- Section 11 selects RPC and generated-client tooling.
- Sections 9 and 13 verify dependency isolation, runtime parity, security,
  determinism, bounded work, and retained selection evidence.
