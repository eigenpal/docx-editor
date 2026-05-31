# Round-trip Block-Level Structured Document Tags

## Why

Block-level Structured Document Tags (`w:sdt` wrapping `w:p`/`w:tbl`) are flattened during parse. `blockContentParser.ts:313-326` recurses into `w:sdtContent` and pushes the inner paragraphs/tables straight to the parent, discarding the wrapper, `w:sdtPr`, and identity. The `BlockSdt` type, the `BlockContent = Paragraph | Table | BlockSdt` union, and a stub serializer branch all exist, but nothing produces a `BlockSdt`, so the path is inert.

Effect: a document loaded, edited anywhere, and saved comes out with every block-level content control removed, with no parse-time warning and no visible difference in the editor. Downstream tooling that addresses regions by `w:tag` (templating engines, automation pipelines, agent-driven edits) silently breaks against the saved file. Inline SDTs already parse and round-trip; this change is scoped to the block-level case (#622).

## What Changes

- The block parser stops flattening `w:sdt`. It emits a `BlockSdt` wrapping the parsed children and capturing the raw `w:sdtPr`/`w:sdtEndPr`.
- **Serialization is capture-and-replay**: the parser stores the original `<w:sdtPr>` (and `<w:sdtEndPr>`) as a verbatim XML string; the serializer re-emits it unchanged, then serializes the (possibly edited) child blocks inside `<w:sdtContent>`. Because the `sdtPr` is never edited in this phase, verbatim re-emission preserves exact element ordering (`CT_SdtPr` is an `xsd:sequence`), avoids duplicate/dropped elements, and round-trips features this editor does not model (data binding, `w15:*`, `lastValue`). The modeled `SdtProperties` fields become a **read-only projection** for downstream tag/alias addressing, not the serialization source. Synthesis from modeled fields is a fallback only for a `BlockSdt` with no captured raw.
- `BlockSdt.content` widens from `(Paragraph | Table)[]` to `BlockContent[]`, and the parser recurses through the same `parseBlockContent`, so nested block SDTs and bookmarks/run-level content inside `sdtContent` survive (otherwise #622 recurs one level down).
- A shared **parser** helper (`docx/sdtProperties.ts`) captures both the modeled projection and the raw string; the inline parser is pointed at it. The inline **serializer** is left unchanged (it already emits the full modeled set and is test-covered) — only verified not to regress.
- `SdtProperties` gains `id` and a raw-XML-string passthrough field; the `SdtType` enum is reconciled with the schema element names (`dropdown` → `dropDownList`, `unknown` for present-but-unmodeled types, `checkbox` documented as the `w14` extension).
- This is parse↔serialize only. No ProseMirror node, no painter, no editing UI — block SDTs survive a load→save cycle but are not yet individually editable (deferred to a follow-up change).

## Impact

- Affected specs: `block-sdt` (new)
- Affected code:
  - `packages/core/src/types/content/sdt.ts` — add `id`, raw-XML-string passthrough (NOT an `XmlElement`, to avoid leaking the parser type into the `@public` surface); widen `BlockSdt.content` to `BlockContent[]`; reconcile `SdtType`
  - `packages/core/src/docx/sdtProperties.ts` (new) — shared property parser; captures modeled projection + raw `sdtPr`/`sdtEndPr` string via `xml-js` `js2xml`
  - `packages/core/src/docx/blockContentParser.ts` — emit `BlockSdt` (via a small shared `parseBlockSdt` helper); widen `parseBlockContent` return to `BlockContent[]`
  - The **three** real `parseBlockContent` callers: `documentParser.ts:235` (body — `DocumentBody.content` is already `BlockContent[]`), `headerFooterParser.ts:205`+`259` (the real ripple — `HeaderFooter.content` at `headerFooter.ts:37,91,107` must widen from `(Paragraph|Table)[]`), and the self-recursion at `blockContentParser.ts:323`. Table cells (`parseCellContent`) and text boxes (`textBoxParser`) are **separate loops** that don't use `parseBlockContent` — block-SDT support there is out of Phase 1 scope (see Open Questions)
  - `packages/core/src/docx/paragraphParser/content.ts` — inline parser uses the shared helper (local `parseSdtProperties` at `:59`)
  - `packages/core/src/docx/serializer/documentSerializer.ts` — verbatim block branch (`:575-582` today only emits alias+tag)
  - `packages/core/src/docx/__tests__/sdt-content-roundtrip.test.ts` — block fixtures + passthrough/ordering/nesting tests
- Public API: `SdtProperties`/`BlockSdt`/`SdtType`/`InlineSdt` are `@public`; `bun run api:extract` is **mandatory** (the snapshot will change). Changeset: `patch` for `@eigenpal/docx-editor-core`.

## Open Questions

- **Block SDTs inside table cells and text boxes** go through separate parser loops (`parseCellContent`, `textBoxParser`) that today drop a block `w:sdt` entirely. Phase 1 fixes the body + header/footer path (`parseBlockContent`), which covers the issue's reproduction. Cell / text-box block SDTs are a fast-follow that routes those loops through the same `parseBlockSdt` helper — small, but separate code paths, so deferred to keep this PR reviewable. Flag if they must be in the first PR.
- Otherwise none blocking. Editing support (PM node, FlowBlock 3-switch, painter, React/Vue parity), template-variable extraction from SDT `tag`/`alias`, and lock enforcement are deferred to follow-up changes. `w15:repeatingSection` (likely round-trips for free via raw passthrough + nested `BlockSdt`, but full support deferred) and `CT_SdtRow`/`CT_SdtCell` (SDTs wrapping whole rows/cells — distinct from a block SDT _inside_ a cell) are out of scope and tracked separately.
