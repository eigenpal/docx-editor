## Why

`word-like-field-rendering` taught the page to paint a field's CACHED result. A whole class of text-like fields has no cached result to paint, because Word derives their display from somewhere else and re-renders it on every open:

- **`SYMBOL`** (§17.16.5.60) displays a character code named in the instruction. Real files carry no result runs at all, so the field painted nothing.
- **`MACROBUTTON` / `GOTOBUTTON`** (§17.16.5.36, §17.16.5.31) display the text after their first argument. Same shape: no cached result, blank page.
- **`FORMCHECKBOX` / `FORMDROPDOWN`** (§17.16.5.22, §17.16.5.16) keep their state in `w:ffData` under the begin `w:fldChar`. A checkbox painted nothing; a dropdown painted only whatever the producer happened to cache.
- **`w:sym`** runs (§17.3.3.30) are generic in the canonical tree and worth zero model offsets, so a symbol character vanished from the page even though the run around it painted.
- **`HYPERLINK` fields** — the field spelling of a link, with no `w:hyperlink` element — painted their result as plain text. The typed-link lane resolves canonical node ids, so it could never make one clickable.
- **A `PAGE`-family field nested inside another complex field** (a `STYLEREF` wrapping `PAGE`, say) stamped the producer's cached sheet number onto every page. The nested-field lane only evaluated the `w:fldSimple` shape.
- **A field code under a tracked edit** leaves `w:delInstrText` beside `w:instrText`. The deleted chunks were invisible to the instruction buffer, so a field whose whole code was pending deletion lost its instruction — and with it, its rendering.

Each of these is display the file fully specifies. Painting nothing where Word paints text is a fidelity defect, not a deferral.

## What Changes

**`w:sym` symbol runs render.** The glyph projects at its insertion point as a rendering-only piece over ZERO model width, so the store's offset authority does not move. Symbol-font bytes normalize through the same 0xF000-page PUA mapping as list bullets (`symbol-encoding.ts`); parsing of the attacker-controlled attributes fails closed to no glyph.

**`SYMBOL` renders from its instruction.** `\f` overrides the font, `\s` the size in whole points, `\u` reads the code as a Unicode codepoint. Tokenization is one bounded pass over an already-capped string; every hostile or malformed instruction resolves to null and the field falls back to what it painted before.

**`HYPERLINK` fields are live links**, complex and `w:fldSimple` alike. Layout parses the instruction into raw strings and NEVER builds an href; the surface's field-link registry applies the same `sanitizeHref` plus absolute-URI gate a relationship target must clear, mints span link records, and resolves clicks. A refused target falls back to the `\l` anchor or to no link at all. The registry fails closed at its cap: past it a new target paints plain text. The hyperlink popover shows a field link read-only. Footnote and endnote stories project links too — typed `w:hyperlink` and `HYPERLINK` fields both.

**Legacy `FORMCHECKBOX` / `FORMDROPDOWN` render from `w:ffData`.** The checkbox paints ☒ or ☐ from its checked (or default) bit — state is the authority, so a stale cached glyph never wins; explicit `w:size` sets the glyph size and `w:sizeAuto` keeps the run's. The dropdown prefers its cached result and synthesizes the selected `w:listEntry` only when the file cached none. The `ffData` reader is bounded and reads state only — macro, name, and help fields are never read.

**`MACROBUTTON` / `GOTOBUTTON` render their display text.** The macro name or jump target is consumed and discarded: nothing executes, nothing navigates, and no caller may wire a click to one. A non-empty cached display wins over synthesis.

**Nested `PAGE` / `NUMPAGES` / `SECTIONPAGES` evaluate live inside complex outer fields**, at any nesting level 2..4, per sheet, matching the `w:fldSimple` lane. The tracker is level-aware: only the level whose `separate` armed it can append and disarm, so a begin/end pair inside a tracked result cannot clear tracking mid-field. Detection and projection share one allowlist so they cannot drift.

**Deleted instructions are recognized.** Live (`w:instrText`) and deleted (`w:delInstrText`) chunks buffer separately at every nesting level; the live buffer answers whenever any live element exists, and the deleted buffer answers only when none does. Synthesis is revision-aware — a result the display mode resolved away is free to be filled, a result the file hides stays hidden — demoted fields still shade, and nested field state survives drawing descents.

**Document-property fields render from the file's metadata.** `TITLE`, `AUTHOR`, `SUBJECT`, `KEYWORDS`, `LASTSAVEDBY`, `COMMENTS`, and `DOCPROPERTY "Name"` over that same fixed set paint the matching value from `docProps/core.xml` and `docProps/app.xml` when the field caches no result. The reader matches only the known properties by exact (namespace, localName), trims and length-caps each value at the trust boundary, and the paint sink writes text, never markup. A DATE-valued property (`CREATEDATE`, `SAVEDATE`, `PRINTDATE`) is deliberately not evaluated. Every story resolves them: body, tables, notes, headers, footers, and text boxes.

**Body `PAGE` / `NUMPAGES` / `SECTIONPAGES` evaluate in the flow.** The value is unknown while a paragraph is measured, so the paragraph walk reserves one model unit and paints a kind-marked placeholder digit; document finalize substitutes the per-page value once pagination converges. The field stays one model unit whatever the digit count, so offsets never move. It is measured at the one-digit placeholder width — a multi-digit value mid-line keeps that width rather than reflowing following text. `DATE`, `TIME`, and `FILENAME` stay out of scope.

**One ratified scenario is amended.** `field-result-rendering` said an empty result paints nothing while holding its one model unit. That stays true for every cached-result field — but the synthesizing kinds above exist precisely because their files cache nothing, so for them an empty result is the trigger, not the answer.

## Impact

- `core/layout`: new `symbol-run.ts`, `field-symbol.ts`, `field-button.ts`, `field-form.ts`, `field-link.ts`, `field-nested-page.ts`, `field-run-text.ts`, `field-doc-property.ts`, `field-page-furniture.ts`, `field-synthesis.ts`; `field-instruction.ts` (dual live/deleted buffers, per-level state), `field-projection.ts`, `field-simple-result.ts`, `field-pieces.ts`, `paragraph-flow.ts`, `semantic-layout.ts`, `semantic-table-layout.ts`, `note-layout.ts`, `note-pagination.ts`, `textbox-story-layout.ts`, `hf-layout.ts`.
- `core/store`: `field-nodes.ts` (`legacyFormFieldDataOf` — bounded, state only), new `package/document-properties.ts` (bounded metadata reader, fixed known properties only).
- `core/binding`: `tree-session.ts` reads document properties for field resolution.
- `core/editor`: new `surface-field-links.ts` (the one href trust boundary for field links), `paginated-surface.ts`.
- `react`: the hyperlink popover stays open for field links, read-only.
- No field instruction is ever executed, fetched, or resolved against a host origin. Every parser fails closed on hostile input.
- No behaviour change for documents with none of these fields.
