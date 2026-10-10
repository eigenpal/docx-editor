# Design — typed footnotes and endnotes

## Context

`typed-ooxml-paragraph-editor` is the production authority. Its D7 inventory lists footnotes and endnotes as deferred with a named future gate; this change is that gate and does not reopen D1–D13.

The gap is sharper than the ledger records. `packages/core/src/layout/story-roots.ts` returns a story only for a `w:hdr` root, a `w:ftr` root, or a `w:body` descendant. `word/footnotes.xml` has a `w:footnotes` root, so it never flows. A note's text is preserved in the canonical tree and never appears on a page, and nothing reports that.

## Decisions

### N1: Note nodes are typed, note bodies are ordinary block content

Adding `footnotes`, `endnotes`, `note`, `noteReference`, and the run-inner marks
`noteRef` / `separator` / `continuationSeparator` to the kind union follows D1's
rule: type what layout needs, leave the rest generic. D8 expansion for this
vocabulary (including run-inner marks) is accepted. A note body is not a special
content model — `CT_FtnEdn` holds `EG_BlockLevelElts`, the same group the body
holds — so the note node's children are the existing typed paragraph and table
kinds. Authored `ST_FtnEdn` `normal` is preserved (not normalised away).

Rejected: keeping notes generic and special-casing them in layout. Layout would then read `localName` strings, which is exactly the DOM-authority pattern D1 and D5 forbid.

### N2: A note reference is a typed run child, not text

The reference must be addressable by `TreeDocOp`, which addresses by node id and UTF-16 offset. A generic node inside a run is preserved but has no defined offset contribution, so a delete spanning it cannot be validated. Typing it fixes both the offset accounting and the caret-stop behaviour.

The reference also must not become a character. `w:footnoteReference` has no text; the *displayed* mark is derived. Storing the mark as text would make it editable, would break on renumbering, and would corrupt the paragraph's text for search and for agents.

### N3: Numbers are derived, ids are stored

`w:id` on `CT_FtnEdn` is an opaque key. The comprehensive fixture proves it: `-1` and `0` are separators, real notes are `1..3`, and nothing forces id order to match reference order. Storing a display number would mean rewriting notes on every insertion — a tree mutation, a `ModelChange`, and a save diff, for a value that is a pure function of order.

`numRestart="eachPage"` settles the argument: under it a note's number depends on which page its reference lands on, which is not known until layout. It cannot be stored at all.

### N4: A note is a story, laid out like header/footer furniture but selectable

`hf-layout.ts` already does most of this: lay a story out at a content width with no pagination, keep its `flowHeight`, namespace its line ids, and let the body pass attach it. `note-layout.ts` is the same shape.

The difference is authority over the page. A header's `flowHeight` sizes a fixed box in the margin. A footnote's `flowHeight` *consumes body space on the page it lands on*, and which page that is depends on where its reference paginates. That is why notes get their own module rather than a flag on `hf-layout.ts`.

The other difference is interaction. Page furniture is `contenteditable=false` and `[data-docx-hf]`, excluded from selection. A note body is document content: selectable, editable, and part of the caret space.

### N5: The feedback loop gets a bound and a named fallback, not a heuristic

Area height shrinks the body box, which changes what fits, which changes the area. This is genuinely circular and has no fixed point in the pathological case.

D12 already requires that any unproven layout state falls back to a clean full layout and that conformance asserts on reasons rather than wall-clock. The same discipline applies here: bound the attempts per page, and on exhaustion keep the reference and its note together on the later page — the choice Word makes — and emit a named reason the conformance suite asserts on. A silent tie-break would make a mis-laid document indistinguishable from a correct one.

### N6: Note operations are `flow-structural` at minimum

A note operation always changes the referencing page's available height, so its `ModelChange` impact class can never be `text-local` or `paragraph-local`. Understating it would let incremental layout reuse a suffix that is no longer valid — the exact risk D12 names.

### N7: One editing scope, rebound to the focused note

A document with 200 footnotes must not mount 200 editing surfaces. The painted
surface is already the editable surface; a note body is a region of it with its
own story identity. Focus selects the story; the surface does not multiply.

`EditorScope` keeps the shipped `{ kind: 'note'; id: string }` arm. The id encodes
kind + signed note id as `footnote:<id>` / `endnote:<id>` (helpers
`formatNoteScopeId` / `parseNoteScopeId`). Do not invent a parallel
`{ noteKind, noteId }` scope union.

`TreePackageStore` opens **one lazy store per notes part**
(`StoryScope { kind: 'notesPart'; noteKind }`), resolved through safe document
relationships — not one store per note. Editing focus still uses `EditorScope.note`.

### N8: The fixture's separator defect is tolerated, not imitated

Both separator notes in the comprehensive fixture contain a `w:footnoteRef` run that Word does not emit. Accept it, do not draw a number for it, round-trip it unchanged. A parser tuned to make this file look right — by treating any `w:footnoteRef` as a numbered mark — would draw a number above the separator rule on real files.

## Open questions

1. **Endnote separators.** The fixture's `endnotes.xml` declares separators, but Word draws no separator before a `docEnd` endnote block in most templates. What we draw, and on what evidence, is unresolved. Task 3.6 requires the answer to come from a Word comparison, not from the schema.

2. **Notes inside headers, footers, and other notes.** The schema permits a reference anywhere a run is permitted; Word forbids authoring one in a header. The model must round-trip such a file. Whether layout has a defined answer is out of scope, and the requirement above says the reference is *removed with its note*, not that it is laid out.

3. **Interaction with tracked changes.** Inserting a note in suggesting mode should track the reference and mark the body inserted, and rejecting the insertion should remove both. That is owned by `typed-revisions-and-comments`; this change must not invent a second revision model. Whichever lands second reconciles.

4. **D8 boundary expansion.** **Accepted** for typed note vocabulary including
   run-inner marks (`noteRef`, `separator`, `continuationSeparator`), note
   references, note-body block content, and note properties (`CT_FtnProps` /
   `CT_EdnProps`). Numbering reuses shared `formatNumFmt` — no forked
   `ST_NumberFormat`.

5. **Vue parity.** Out of scope by request. `paragraph-adapter-acceptance` gates production support on paired adapters, so this change alone cannot produce a support claim. Task 7.1 records that rather than letting the omission read as completion.

### Settled ownership (layout follow-up)

- Footnote positions include all four `ST_FtnPos` values (`pageBottom`,
  `beneathText`, `sectEnd`, `docEnd`). Endnote positions are `sectEnd` /
  `docEnd` only (`pageBottom` refused at mutation).
- Endnote separator paint at `docEnd` remains open question 1 (Word comparison).
- Layout/surface integration is a follow-up once shared layout files are free.
