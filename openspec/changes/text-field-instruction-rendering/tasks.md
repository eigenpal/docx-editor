## 1. Symbol runs (`w:sym`)

- [x] 1.1 `symbol-run.ts`: typed check for the generic `w:sym` child, strict bounded hex parse, 0xF000-page PUA normalization shared with `symbol-encoding.ts`, capped font length, fail-closed on surrogates and noncharacters
- [x] 1.2 Project the resolved glyph as a rendering-only piece over zero model width, at the symbol's insertion point, with the font override carried on the piece
- [x] 1.3 Tests: mapped and bare-byte codes, `\u`-style real Unicode families, hostile attributes, and offset neutrality

## 2. SYMBOL field

- [x] 2.1 `field-symbol.ts`: bounded tokenizer, `\f` / `\s` / `\u` switches, length-capped numeric parses, every failure resolving to null
- [x] 2.2 Reuse `symbol-run.ts` glyph resolution so the two symbol paths cannot drift
- [x] 2.3 Synthesize over the field's single atom unit on both the complex and `w:fldSimple` lanes; a resolved glyph wins over stale cached text
- [x] 2.4 Tests: fonts, sizes, unicode mode, hostile instructions, both field shapes

## 3. HYPERLINK fields

- [x] 3.1 `field-link.ts`: bounded instruction parser producing raw strings — target, `\l` anchor, `\o` tooltip — and never an href
- [x] 3.2 `surface-field-links.ts`: the one trust boundary — `sanitizeHref` plus the absolute-URI gate, target-over-anchor precedence, anchor fallback, no-link fallback, per-target id minting, click resolution, fail-closed registry cap
- [x] 3.3 Route painted field-link clicks through the existing navigation gesture; nothing fetches or navigates on open
- [x] 3.4 Keep the hyperlink popover open for field links, read-only (`react` popover + `useHyperlinkPopup`)
- [x] 3.5 Project links in footnote and endnote stories — typed `w:hyperlink` and HYPERLINK fields both
- [x] 3.6 Tests: sanitization refusals, anchor fallback, registry cap, popover behaviour, note-story links

## 4. Legacy form fields

- [x] 4.1 `store/package/field-nodes.ts`: `legacyFormFieldDataOf` — bounded `w:ffData` reader, state only, macro/name/help fields never read
- [x] 4.2 `field-form.ts`: checkbox glyph from `w:checked` / `w:default`, `w:size` override, `w:sizeAuto` keep; dropdown selected `w:listEntry` synthesized only when no cached result exists
- [x] 4.3 Fail closed on instruction/ffData mismatch, empty entry lists, and empty entries
- [x] 4.4 Tests: reader bounds, both glyphs, size semantics, dropdown selection and cached-result precedence

## 5. MACROBUTTON / GOTOBUTTON

- [x] 5.1 `field-button.ts`: bounded display-text parser; macro name / jump target consumed and discarded; trailing formatting switch stripped without eating interior backslashes
- [x] 5.2 Synthesize the display text on both lanes; a non-empty cached display wins
- [x] 5.3 Tests: quoting, interior whitespace, trailing switches, never-executes contract

## 6. Nested page fields in complex outer fields

- [x] 6.1 Evaluate nested `PAGE` / `NUMPAGES` / `SECTIONPAGES` inside a complex field's cached result per sheet, skipping the cached digits and appending at the inner `end`
- [x] 6.2 `field-nested-page.ts`: level-aware tracker — arms at the level whose `separate` offered it, ignores deeper begins/separates/ends, disarms defensively on a shallower end, never resurrects a wholly suppressed inner result
- [x] 6.3 Align detection with projection on one allowlist, levels 2..4
- [x] 6.4 Copy nested field state across drawing descents
- [x] 6.5 Tests: depths 2..4, `STYLEREF` wrapping, malformed separators, suppression parity with `w:fldSimple`

## 7. Correctness batch

- [x] 7.1 Dual live/deleted instruction buffers per nesting level; live answers whenever any live `instrText` element was seen, deleted only when none was
- [x] 7.2 Revision-aware synthesis suppression: fill a result the display mode resolved away, never one the file hides
- [x] 7.3 Demoted fields still shade
- [x] 7.4 Dropdown and checkbox `w:ffData` size semantics corrections from review
- [x] 7.5 Tests: deleted-only codes, live-beside-deleted codes, mode-resolved vs file-hidden results

## 8. Gates

- [x] 8.1 `bun run typecheck`, `bun run lint`
- [x] 8.2 `bun run test`
- [x] 8.3 `bun run check:parity`, `bun run api:check`, `bun run i18n:validate`
- [x] 8.4 Feature matrix rows in `docs/site/data/word-features.ts` updated to match
- [x] 8.5 `bun run format`
