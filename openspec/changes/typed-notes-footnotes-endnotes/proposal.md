## Why

`deferred-features.md` records footnotes and endnotes as: parse `generic preserved by related story part`; model `untyped note references and bodies`; layout `deferred`; edit `deferred`; save `normalized structural preservation with relationships`. Its named future gate is "typed note identities/references, continuation pagination, scoped editing, save/reopen fixtures, and paired acceptance". This change is that gate.

The current state is more specific than the ledger, and worse. `packages/core/src/layout/story-roots.ts` decides what flows:

```ts
if (root.localName === 'hdr' || root.localName === 'ftr') return root;
// …otherwise find the w:body
```

`word/footnotes.xml` and `word/endnotes.xml` have `w:footnotes` and `w:endnotes` roots. They are never a story, so they are never laid out, and no note text reaches a page. `w:footnoteReference` inside a body paragraph is a `generic` node inside a typed `run` — it round-trips through the canonical tree and paints nothing. A reader of the rendered document loses every citation in the file with no diagnostic.

`e2e/fixtures/comprehensive-word-element-test.docx` makes that concrete: three footnote references, two endnote references, three real footnotes, two real endnotes, and separators — none of it visible.

D8 fixes the accepted paragraph-property boundary and states that expanding it "requires a reviewed specification change". This is that change for the note lane.

## What Changes

**Canonical tree — typed note kinds**

- Add `footnotes`, `endnotes`, `note`, and `noteReference` to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`, which today runs `document | body | table | tableRow | tableCell | tableGrid | tableProperties | paragraph | run | runProperties | text | paragraphProperties | tab | hardBreak | generic | textValue`.
- `note` carries the numeric `w:id` from `CT_FtnEdn` and its `w:type` (`separator`, `continuationSeparator`, `continuationNotice`, or absent for a normal note). Its children are ordinary block content, so a note body is the same paragraphs and tables the body uses.
- `noteReference` carries `noteKind`, `noteId`, and `customMarkFollows` from `CT_FtnEdnRef`. It is a typed child of a `run`, not a generic node, so semantic interaction can address it.
- Anything inside a note part this vocabulary does not describe stays `generic`, per D1. Demotion rules are unchanged.

**Note properties**

- Add `CT_FtnProps` / `CT_EdnProps` reading to `packages/core/src/layout/section-properties.ts`: `pos` (`ST_FtnPos`: `pageBottom` | `beneathText` | `sectEnd` | `docEnd`; `ST_EdnPos`: `sectEnd` | `docEnd`), `numFmt`, and the `EG_FtnEdnNumProps` group (`numStart`, `numRestart` — `ST_RestartNumber`: `continuous` | `eachSect` | `eachPage`).
- Resolution order: section `w:sectPr`, then document `w:settings`, then the OOXML default. Authored values stay distinguishable from resolved ones so an unedited document does not gain explicit properties on save.

**Stories and layout**

- `storyBlocks` learns note roots: each `w:footnote` / `w:endnote` is its own story, so a note body flows through the same `flowBlocksInBox` path headers and footers already use.
- New `packages/core/src/layout/note-layout.ts`, sibling to `hf-layout.ts`: lay a note story out at the section content width, return its `flowHeight`, and let the body pass reserve that height on the referencing page.
- Footnote area placement per resolved `pos`; endnote collection per resolved `pos`; separator and continuation-separator drawn from the document's own separator notes.
- Displayed note numbers are **derived** from reference order under the resolved numbering, never stored.
- The footnote-area/body-height feedback loop is bounded with a named fallback, consistent with D12's "conservatively restart clean full layout" discipline.

**Editing**

- `TreeDocOp` gains note operations: insert a reference plus its body, delete the pair, set note properties, convert footnote ↔ endnote. All commit through `TreeDocumentStore.transact`; nothing else writes.
- Note bodies become an editable scope on the painted surface, alongside the body. Page furniture stays `contenteditable=false`; a note body is not furniture.

**React adapter**

- Two new chrome slots, `insert.footnote` and `insert.endnote`, wired in `SLOT_COMMANDS` so both adapters light up together. `ChromeSlotId` is public API forever, so the ids are chosen once.
- Note properties dialog, reference↔note navigation, hover preview, and a note context menu, all as hook consumers of the provider, per the adapter's provider-first rule.

## Capabilities

### New Capabilities

- `notes-canonical-model`: typed note kinds, note references as typed run children, note-property resolution, derived numbering, and the two D9 oracles applied to note parts.
- `notes-semantic-layout`: note stories, footnote-area reservation, separators, continuation, endnote placement, and the bounded feedback loop.
- `notes-authoring-surface`: chrome slots, the note editing scope, navigation, preview, and the properties dialog.

### Modified Capabilities

None. The note lane in `deferred-features.md` moves from deferred to supported, and that ledger entry is rewritten rather than deleted.

## Fixture evidence

Measured from `e2e/fixtures/comprehensive-word-element-test.docx` (md5 `51f0d1ee47b01afc02a848154be8ac26`).

Exercised:

| Feature | Evidence |
| --- | --- |
| Footnote part | `word/footnotes.xml`, 5 `w:footnote` (ids `-1`, `0`, `1`, `2`, `3`) |
| Endnote part | `word/endnotes.xml`, 4 `w:endnote` (ids `-1`, `0`, `1`, `2`) |
| Body references | 3 `w:footnoteReference`, 2 `w:endnoteReference` |
| Separators | `w:separator` and `w:continuationSeparator` in both parts |
| Note-internal formatting | footnote `w:id="2"` mixes `w:b` and `w:i` runs |
| Built-in note styles | `FootnoteReference`, `EndnoteReference`, `EndnoteText` |
| Package wiring | `endnotes.xml` is `rId50` in `word/_rels/document.xml.rels`, declared in `[Content_Types].xml` |

Not exercised, so not claimable from this file:

- Any `w:footnotePr` or `w:endnotePr`. Neither `word/settings.xml` nor any of the five `w:sectPr` carries one — the entire numbering-and-position surface sits at defaults.
- Custom note marks (`w:customMarkFollows`).
- Notes containing a table, an image, or a list. Every note here is one paragraph of runs.
- Note continuation across a page break, and `w:continuationNotice`.
- Notes referenced from a header, a footer, or another note.

Fixture defect to tolerate, not to imitate: both `w:separator` and `w:continuationSeparator` notes contain a `w:footnoteRef` run, which Word does not emit. The parser must accept it, must not draw a number for it, and must round-trip it unchanged.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — four new typed kinds and their demotion rules.
- `packages/core/src/store/store/tree-ops.ts`, `tree-op-validate.ts`, `tree-op-apply.ts` — note `TreeDocOp`s.
- `packages/core/src/layout/story-roots.ts` — note roots become stories.
- `packages/core/src/layout/note-layout.ts` (new), `semantic-layout.ts`, `semantic-records.ts`, `section-properties.ts`.
- `packages/core/src/output/semantic-paint.ts` — the note area and its separator.
- `packages/core/src/layout/semantic-interaction.ts` — hit-testing and caret stops inside a note.
- `packages/core/src/editor/chrome-controls.ts`, `toolbar-commands.ts` — two new slots and their rows.
- `packages/react/src` — dialog, navigation, preview, context menu, i18n keys.
- **Vue**: out of scope by request. The repository rule requires layout and measurement changes in both adapters, and `paragraph-adapter-acceptance` gates production support on paired adapters. This change therefore cannot claim production support on its own; that is stated in `tasks.md` §7 rather than left implicit.
- **Not included**: `w:continuationNotice` authoring, notes inside headers/footers/notes (round-tripped, not laid out), tracked note insertions (owned by `typed-revisions-and-comments`).
