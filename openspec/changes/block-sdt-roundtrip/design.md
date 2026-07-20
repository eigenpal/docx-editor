# Design

## Context

`w:sdt` (Structured Document Tag, "content control") has a block form (`CT_SdtBlock`, schema `wml.xsd:2067`) wrapping block content, and an inline/run form (`CT_SdtRun`, `wml.xsd:2074`) wrapping runs. Inline already works end to end. Block is parsed-then-flattened (`blockContentParser.ts:313-326`), so it never reaches the model.

`CT_SdtBlock` = `sdtPr?` + `sdtEndPr?` + `sdtContent`. `CT_SdtContentBlock` (`wml.xsd:2061`) is `EG_ContentBlockContent*` (`wml.xsd:2030`), a choice of **`customXml | sdt | p | tbl | EG_RunLevelElts`** — i.e. paragraphs, tables, **nested block SDTs**, customXml wrappers, and run-level elements (bookmarks, ins/del, etc.). A block SDT can wrap **many** children, not one.

`CT_SdtPr` (`wml.xsd:1971`) is an **`xsd:sequence`** — child order is mandatory: `rPr, alias, tag, id, lock, placeholder, temporary, showingPlcHdr, dataBinding, label, tabIndex`, then a single type-marker `xsd:choice` (`equation | comboBox | date | docPartObj | docPartList | dropDownList | picture | richText | text | citation | group | bibliography`). `ST_Lock` = `sdtLocked | contentLocked | unlocked | sdtContentLocked`. `w:placeholder` holds a single `w:docPart` whose `@w:val` is a **glossary building-block name** (a reference key), not literal placeholder text.

## Goals / Non-Goals

- Goal: a block SDT survives parse→serialize losslessly, including `sdtPr` features and `sdtContent` children this editor does not model.
- Goal: one shared property **parser** for inline and block so the read-side projection cannot drift.
- Non-goal: editing block SDTs in ProseMirror, painting them, template extraction, lock enforcement. Those are follow-ups that build on the model this change establishes.

## Key Decision: capture-and-replay the raw `sdtPr`

The original plan ("emit modeled fields, then spread back unmodeled children") is **wrong** — `CT_SdtPr` is a sequence, so partitioning into "managed then raw" reorders children and can place `dataBinding` or a passthrough element after the type-marker choice, producing invalid OOXML that Word repairs (silently dropping data binding). It also risks double-emitting elements we both model and pass through, and loses attributes like `dropDownList/@lastValue`.

Instead, because Phase 1 is **round-trip only — the `sdtPr` is never edited** — the serializer **captures the entire `<w:sdtPr>` (and `<w:sdtEndPr>`) at parse time and re-emits it verbatim**. The modeled `SdtProperties` fields (`id`, `alias`, `tag`, `lock`, `placeholderDocPart`, `showingPlaceholder`, `sdtType`, `listItems`, `dateFormat`) become a **read-only projection** for downstream tooling (tag/alias addressing, future template extraction) and are **not** the serialization source. This single decision resolves four issues at once:

- **Element ordering** — verbatim re-emission preserves the exact `CT_SdtPr` sequence.
- **No double-emission / no duplicate type-marker** — nothing is re-synthesized, so no element is emitted twice and the `xsd:choice` stays singular.
- **`w:id` fidelity** — the exact original text (sign, leading zeros) round-trips.
- **No public-type leakage** — the raw blob is stored as an **XML string**, not an `XmlElement`, so the `types/content/` layer does not gain a dependency on the parser layer and `XmlElement` does not leak into the `@public` API.

Synthesis from the modeled fields is the **fallback only** for a `BlockSdt` that has no captured raw (e.g. one created programmatically). For Phase 1's parse→serialize path this branch is not exercised, but it must emit a minimal, sequence-valid `sdtPr` so the path is total.

The raw string is produced by re-stringifying the captured `sdtPr` element with `xml-js` `js2xml` (the repo already depends on `xml-js`; `xmlParser.ts` uses `xml2js`). This is faithful for element/attribute content; whitespace/quote-style normalization is immaterial to Word and to tag-addressing consumers. (Implementation note: confirm `js2xml` round-trips namespaced names like `w15:repeatingSection` unchanged; if not, fall back to a small recursive stringifier that preserves child order and attributes.)

## Content recursion — widen to `BlockContent[]`

`BlockSdt.content` must be `BlockContent[]`, not `(Paragraph | Table)[]`, and the parser must recurse through the **same** `parseBlockContent`. Otherwise nested block SDTs and bookmarks/run-level content inside `sdtContent` are dropped — recreating #622 one level down. The issue explicitly names bookmarks as the round-trip-safe anchor, so a block SDT wrapping a bookmarked region is a realistic case that must not lose the bookmark. This also yields a **surprise win**: a `w15:repeatingSection` control round-trips largely for free — its `w15:repeatingSection` marker survives via the raw `sdtPr`, and its inner repeating-item SDTs survive via nested `BlockSdt` — even though full repeating-section support is deferred.

## Parser placement (block vs inline)

Block-vs-inline is **contextual**, not content-sniffed: `w:sdt` reachable via `EG_ContentBlockContent` (body, table cell, text box, nested `sdtContent`) is `CT_SdtBlock`; `w:sdt` inside a paragraph (`EG_PContent`) is `CT_SdtRun`. The block parser runs only in block context, so **every `w:sdt` it sees is a `CT_SdtBlock` by construction** — no heuristic needed.

There are, however, **three independent block-content loops** in the codebase, and only one is `parseBlockContent`:

- `parseBlockContent` (`blockContentParser.ts`) — used by the **body** and **headers/footers**. This is where the flatten-on-parse bug lives and what this change fixes.
- `parseCellContent` (`tableParser.ts:550`) — **table cells**. A separate loop that today handles only `w:p`/`w:tbl` and **silently drops** a block `w:sdt` (and its content) entirely.
- `textBoxParser.ts` — **text boxes**. Its own loop over `parseParagraph`.

To stay DRY and correct, the `w:sdt → BlockSdt` emission is extracted into a small shared helper (e.g. `parseBlockSdt(child, …): BlockSdt` in `blockContentParser.ts`, delegating property capture to `sdtProperties.ts`). `parseBlockContent` calls it now (Phase 1). `parseCellContent` and the text-box loop are **out of Phase 1 scope** (see below) but will call the same helper when block-SDT-in-cell / -in-text-box is taken up, so the emission logic is never duplicated.

`CT_SdtCell`/`CT_SdtRow` (SDTs wrapping whole cells/rows) remain out of scope and are distinct from a block SDT that merely sits _inside_ a cell.

## Caller blast radius (return-type widening)

`parseBlockContent` returns `(Paragraph | Table)[]` today. Emitting `BlockSdt` widens it to `BlockContent[]`. Verified callers (only **three**, not the five an earlier draft listed):

1. `documentParser.ts:235` — body. Assigns into `DocumentBody.content`, which is **already `BlockContent[]`** (`section.ts:176`). No type change needed here.
2. `headerFooterParser.ts:205` and `:259` — header/footer. Assigns into `HeaderFooter.content`, typed **`(Paragraph | Table)[]`** (`headerFooter.ts:37,91,107`). **This is the real ripple** — that field (across the three HF interfaces) must widen to `BlockContent[]`, or the two call sites filter locally.
3. `blockContentParser.ts:323` — self-recursion into `sdtContent`.

`tableParser.ts` (cells via `parseCellContent`) and `textBoxParser.ts` are **not** callers of `parseBlockContent`; they are the separate loops noted above and are out of Phase 1 scope. `bun run typecheck` drives the exact trace.

## SdtType projection (read-only) reconciliation

The enum is projection-only in Phase 1 (serialization is verbatim), but it should still be correct:

- `dropdown` → rename to **`dropDownList`** (schema element `w:dropDownList`). Verified blast radius is **3 files** — the enum (`sdt.ts:20`), the inline parser (`paragraphParser/content.ts:96`), and the inline serializer (`serializer/paragraphSerializer/content.ts:218`). The PM-conversion files do **not** hardcode the `'dropdown'` literal (they pass `sdtType` through generically), so the rename is safe and small; a round-trip test locks the value. (`SdtExtension.ts` only mentions `dropdown` in a doc comment — update for accuracy.)
- `plainText` ↔ schema `w:text` (CT_SdtText, `@multiLine`) — keep the friendly name, document the mapping.
- `checkbox` is **not** base ECMA-376; it is the `w14:checkbox` (Office 2010) extension — detect in the `w14` namespace and document it as an extension.
- `buildingBlockGallery` collapses schema's distinct `w:docPartObj` (gallery) and `w:docPartList` (list) — lossy for the projection only; verbatim serialization preserves the real element.
- Add or explicitly account for `equation`, `citation`, `bibliography`.
- **Typeless `sdtPr` defaults to `richText`** (the spec default). A type marker that is _present but unmodeled_ must map to **`unknown`**, never coerced to `richText`, so the projection stays honest.

## Inline path — share the parser only; do not regress the serializer

The original plan claimed the inline **serializer** had "the same partial-output gap." It does not — `serializeInlineSdt` (`serializer/paragraphSerializer/content.ts:197`) already emits `alias, tag, lock, showingPlcHdr`, the type markers, list items, date, and `w14:checkbox`. The alias+tag-only emitter is the **block** branch (`documentSerializer.ts:575-582`). So this change:

- Extracts a shared **parser** helper, `docx/sdtProperties.ts`, that captures both the modeled projection **and** the raw `sdtPr` string. It imports the XML helpers from **`./xmlParser`** (the real module — `findChild`/`getAttribute`/`getChildElements`/`elementToXml` all live there; there is **no** `docx/xmlUtils.ts`). The inline `sdt` case (`paragraphParser/content.ts:671`, local `parseSdtProperties` at `:59`) is pointed at it. The helper is a superset (adds `id` + raw capture), so confirm no inline projection regresses.
- Leaves the inline **serializer** as-is (it works and is test-covered). Adopting raw-verbatim passthrough for inline too is a sound follow-up but is **not** required here; existing inline round-trip tests must stay green to prove no regression.
- Adds the verbatim block serializer as the `block.type === 'blockSdt'` branch inside `serializeBlockContent` in `serializer/documentSerializer.ts` (there is no standalone `serializeBlockSdt` function — it is an inline branch). The raw `sdtPr`/`sdtEndPr` strings are spliced in directly (no escaping needed — they are already-serialized XML). The fallback-synthesis path (no raw captured) escapes via `escapeXml` from `serializer/xmlUtils.ts`; note `documentSerializer.ts` currently imports only `intAttr` from there, so add the `escapeXml` import.

## Test harness

The existing `__tests__/sdt-content-roundtrip.test.ts` is a **paragraph-level** harness (`parseParagraph` / `serializeParagraph` via `parseXmlDocument`), correct for inline SDTs. Block SDT fixtures need a **body-level** path: `parseDocumentBody(documentXml, …)` (`documentParser.ts:197`) + `serializeDocumentBody(body)` (`documentSerializer.ts:604`). (`serializeBlockContent` itself is private/unexported.) New block tests should use the body-level entry points; existing inline tests stay on the paragraph harness.

## Public API impact

`InlineSdt` and `BlockSdt` are reachable from the `@public` surface via `ParagraphContent` and the `BlockContent` union; `SdtProperties`/`SdtType` are re-exported through the `types/document.ts` barrel. Whether each appears standalone in the API Extractor snapshot (`docs/api/docx-editor-core/headless.api.md`) varies, so treat `bun run api:extract` as **mandatory** and commit any drift — do not assume it is a no-op. Storing raw passthrough as a `string` (not `XmlElement`) keeps the `xml-js` `Element` type out of the public surface and preserves the `types/ → (no dependency on) → docx/` layer boundary.

## Risks

- `js2xml` fidelity for namespaced/extension elements — mitigated by the recursive-stringifier fallback and a passthrough test using a realistic `w:dataBinding` (required `xpath`+`storeItemID`, optional `prefixMappings`) plus a `w15:*` element.
- Return-type widening touching a content field that a Phase-1-out-of-scope consumer cannot handle — mitigated by typecheck and local narrowing where justified.
- Nested block SDTs / empty-or-absent `sdtContent` / bookmark-only `sdtContent` are valid; parser must not throw or drop the wrapper.
