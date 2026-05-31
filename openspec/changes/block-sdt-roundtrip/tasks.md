# Tasks

## 1. Types

- [ ] 1.1 Add `id?: number` and a raw passthrough field to `SdtProperties` stored as a **raw XML string** (e.g. `rawPropertiesXml?: string`) plus `rawEndPropertiesXml?: string` — NOT an `XmlElement` (avoids leaking the parser type into the `@public` API and inverting the types→parser layer boundary)
- [ ] 1.2 Widen `BlockSdt.content` from `(Paragraph | Table)[]` to `BlockContent[]` (allows nested block SDTs; run-level/bookmark content carried as today)
- [ ] 1.3 Reconcile `SdtType`: `dropdown` → `dropDownList`; map present-but-unmodeled type markers to `unknown` (never coerce to `richText`); document `checkbox` as the `w14` extension and `buildingBlockGallery` as covering both `docPartObj`/`docPartList`; account for `equation`/`citation`/`bibliography`. Update inline parser/serializer/PM-conversions to the canonical `dropDownList` value in the same pass
- [ ] 1.4 Fix the `placeholder` doc comment: it is a `w:docPart` building-block **name reference**, not literal placeholder text

## 2. Shared property parser

- [ ] 2.1 Create `docx/sdtProperties.ts` with `parseSdtProperties(sdtPr)` and `parseSdtControlType(sdtPr)` (default `richText` only when no type marker is present; present-but-unmodeled marker → `unknown`). Import XML helpers from `./xmlParser` (NOT a nonexistent `xmlUtils`)
- [ ] 2.2 Capture the raw `<w:sdtPr>` and `<w:sdtEndPr>` as verbatim XML strings via `elementToXml` (`xmlParser.ts:125`, wraps `js2xml`); verify it preserves namespaced names like `w15:repeatingSection` — fall back to a small order-preserving recursive stringifier if not
- [ ] 2.3 Parse the modeled projection: `id`, `alias`, `tag`, `lock`, `placeholderDocPart`, `showingPlaceholder`, list items (with `displayText`/`value`), `dateFormat`, control type
- [ ] 2.4 Point the inline parser (`paragraphParser/content.ts:671`; local `parseSdtProperties` at `:59`) at the shared helper; delete the local copy. The helper is a superset (adds `id` + raw) — confirm no inline projection regresses

## 3. Block parser

- [ ] 3.1 Change `parseBlockContent` to return `BlockContent[]`. Verified callers: `documentParser.ts:235` (body — `DocumentBody.content` already `BlockContent[]`, no change), `headerFooterParser.ts:205`+`259` (widen `HeaderFooter.content` at `headerFooter.ts:37,91,107` from `(Paragraph|Table)[]` to `BlockContent[]`), self-recursion `blockContentParser.ts:323`. `tableParser`/`textBoxParser` are NOT callers — out of scope
- [ ] 3.2 Extract a small `parseBlockSdt(child, …): BlockSdt` helper (parse `sdtPr` via the shared property helper, recurse children through the same `parseBlockContent`, attach raw `sdtPr`/`sdtEndPr` strings). Replace the flattening branch (`blockContentParser.ts:313-326`) with a call to it
- [ ] 3.3 Handle edge cases without throwing or dropping the wrapper: absent/empty `sdtContent`; `sdtContent` with only a bookmark / run-level content; nested block SDT (requires `BlockSdt.content: BlockContent[]` from 1.2)

## 4. Serializer

- [ ] 4.1 Add a block SDT serializer (under `serializer/`) that emits `<w:sdt>` + raw `sdtPr` verbatim + optional raw `sdtEndPr` verbatim + `<w:sdtContent>` + serialized child blocks. Synthesize a minimal sequence-valid `sdtPr` only when no raw is captured (fallback)
- [ ] 4.2 Wire the `documentSerializer.ts` block branch (`:575-582`) to it; recurse children through the existing block serializer
- [ ] 4.3 Leave the inline serializer (`serializer/paragraphSerializer/content.ts`) unchanged; rely on existing inline tests to confirm no regression

## 5. Verification

- [ ] 5.1 `bun run typecheck` clean
- [ ] 5.2 New round-trip tests green (see spec scenarios): block SDT over one paragraph; over a table; over multiple children; nested block SDT; bookmark inside `sdtContent`; `sdtEndPr` preserved; empty/absent `sdtContent`; block SDT inside a cell; lock; placeholder docPart; dropDownList with `lastValue` + items; **`sdtPr` child ordering valid**; **no duplicate elements**; **unmodeled type marker (e.g. `w:bibliography`/`w14:checkbox`) preserved, not replaced by `w:richText`**; **unmodeled `w:dataBinding` (with `xpath`+`storeItemID`+`prefixMappings`) survives byte-faithfully**
- [ ] 5.3 Existing inline SDT tests still green (no serializer regression)
- [ ] 5.4 `bun run format`; `bun run api:extract` (mandatory — `SdtProperties` is `@public` and changes); `bun changeset` (patch, `@eigenpal/docx-editor-core`)
