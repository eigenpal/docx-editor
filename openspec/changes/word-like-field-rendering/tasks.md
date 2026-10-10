## 0. Baseline before code

- [x] 0.1 Record the `bun test` baseline at the base commit (4757 pass / 113 fail, every failure an uninstalled optional dependency — `harfbuzzjs`, `emf-converter`, `utif2`, unbuilt `@docx-editor.dev/i18n`)
- [x] 0.2 Reproduce on the reported document: the `w:del` around a `FORMTEXT` result paints unattributed, while the review rail reports the replacement correctly
- [x] 0.3 Sweep the fixture corpus for the same shape: 47 unattributed revisions across `list-pagination-break.docx` (46 `REF` insertions) and `issue-319-sections.docx` (a footer `PAGE`/`NUMPAGES` deletion)

## 1. The coverage oracle, first and failing

- [x] 1.1 `revision-attribution-coverage.test.ts`: walk the tree for `revision → text`, project in all-markup for the same map, diff
- [x] 1.2 Strip `\t` and `\f` before comparing — layout adds them for `w:tab` and a page `w:br`, so they are always extra and never missing
- [x] 1.3 Assert the corpus actually loaded, so an oracle that finds nothing cannot pass by finding nothing
- [x] 1.4 Confirm it reports 47 before any fix

## 2. Room to work

- [x] 2.1 `field-projection.ts` was 986 lines against the 1000-line cap; extract `field-page-furniture.ts` (whole-document page-field finalization — it shares only the context type with the walk)
- [x] 2.2 Extract `field-pieces.ts` (the piece vocabulary and `positionalTabOf`), leaving the walk
- [x] 2.3 Re-export both from `field-projection.ts` so every existing importer keeps one import site

## 3. Attribution across the field boundary

- [x] 3.1 `PendingFieldProjection` carries `resultRevisions` and `resultLink`, captured inside the wrapper
- [x] 3.2 Capture the link at `fldChar begin` — reachable because `atomicFieldSpansOf` descends into `w:hyperlink`
- [x] 3.3 Capture revisions from the first result run that survives to be displayed, first-wins across differing stacks
- [x] 3.4 Replay both at `commitAtomicField` through an explicit override, so `push` stays the one place a piece is attributed
- [x] 3.5 Attach the live stack and link inline on the demoted path, where the walk is still inside the wrapper
- [x] 3.6 Tests for both shapes, nesting, the untracked case, the hyperlink case, and the proposed/original views

## 3b. The offset the store and layout disagreed on

- [x] 3b.1 Reported from the browser: clicking in the affected paragraph painted the caret in one place while typing landed elsewhere
- [x] 3b.2 Measure it — that paragraph read `modelLen=155` against `lastEnd=138`, a 17-character shortfall exactly the length of the deleted words; confirmed byte-identical at the base commit, so pre-existing rather than introduced here
- [x] 3b.3 Root cause: `atomicFieldSpansOf` did not descend into revision wrappers, so the struck result run never reached the scan, AND `deletedText` was missing from the result-content kinds an atom swallows. `walkParagraph` builds `covered` from `removeNodeIds`, so it counted those characters a second time as ordinary text
- [x] 3b.4 Descend into content-revision wrappers, as the walk already does for `w:hyperlink`
- [x] 3b.5 Add `deletedText` to the result-content kinds
- [x] 3b.6 Assert `paragraphTextOf(...).length` equals the last laid-out offset for the wrapped-result shape — the test fails without either half of the fix

## 4. The deleted range

- [x] 4.1 Use the reserved `[atomStart, atomStart + 1)` on the atomic path instead of deriving from the running offset
- [x] 4.2 Record whenever the field is deleted, not only when the deletion is suppressed
- [x] 4.3 Test that no range starts before the paragraph, in all three display modes

## 5. `w:fldSimple`

- [x] 5.1 Confirm the gap first — the exclusion in `semantic-paragraph-layout` made this a deferral, not a defect, so it needed a decision rather than a fix
- [x] 5.2 Add `fldSimple` to the content-revision wrapper's allowed children (`CT_RunTrackChange` admits `EG_ContentRunContent`), so a `w:ins` around one stays a revision
- [x] 5.3 Project the cached result as one piece over the same single model unit
- [x] 5.4 Skip nested field chrome and never display `@w:instr`
- [x] 5.5 Respect `w:vanish` and the enclosing display mode
- [x] 5.6 Tests: visible result, offsets unmoved, empty result, hidden result, nested field, instruction never painted, tracked simple field

## 6. Field shading

- [x] 6.1 `hasLegacyFormFieldData` in the store — presence of `w:ffData` only, never walking a subtree that carries macro names
- [x] 6.2 `FieldAtomMarker` on the piece, through `paragraph-flow` onto `StyleSpanRecord`
- [x] 6.3 Share the `ST_OnOff` reader (`settings-onoff.ts`) instead of a second copy of the "present means on unless `@w:val` says otherwise" rule
- [x] 6.4 `view-settings.ts` reads `w:doNotShadeFormData`; memoize the read per package revision at the surface
- [x] 6.5 Paint emits `data-field-atom` plus classes; the stylesheet owns the colour so an inline revision wash outranks it
- [x] 6.6 `--doc-field-shading` token and an `@media print` rule dropping it
- [x] 6.7 `surface-field-shading.ts` moves one class as the caret moves; compare the paragraph id in JS rather than interpolating it into a selector
- [x] 6.8 Tests: the two rules, all three modes, the print rule's selectors, the revision-wins ordering, caret entry/exit, range selections, and a paragraph id carrying selector syntax

## 6b. Review findings

Each reproduced with a throwaway probe before changing anything, and each now pinned by a test.

- [x] 6b.1 **The caret could overrule paint.** `syncActiveFieldShading` keyed off `data-field-atom`, which paint emits for every field, while the class it emits only where shading is enabled. Since the stylesheet paints `--active` unconditionally, entering a field defeated both `fieldShading: 'never'` and the document's `w:doNotShadeFormData`. Key off `.docx-field-atom` — which also makes it a class match rather than an attribute match on the keystroke path (6b.8)
- [x] 6b.2 **Only the first span was marked.** A result splits at its spaces and every span publishes the same one-unit range, so `when-selected` shaded half a cross-reference while `always` shaded all of it. Mark every match
- [x] 6b.3 **A hyperlink holding a `w:fldSimple` demoted whole.** `w:fldSimple` is an `EG_PContent` member and the link's allowed children omitted it, so the link went generic — and layout drops a generic paragraph child entire. A contents entry lost its words as well as its number. Pre-existing, but only reachable now that simple fields render
- [x] 6b.4 **The schema justification was wrong.** `w:fldSimple` is in `EG_PContent`, not the `EG_ContentRunContent` that `CT_RunTrackChange` takes, and the same file said so correctly 60 lines away. The permissiveness is right — Word writes the shape — but it is deliberate width, not schema compliance, and now says so
- [x] 6b.5 **An untracked first result run did not lock the capture.** Guarding on an empty stack let a later tracked run donate its revision to the whole atom, so `Section <w:del>3</w:del>` painted struck through entire. Lock on its own flag: empty is a real answer
- [x] 6b.6 **`deletedRanges` was still gated on the non-atomic branch**, against a comment promising otherwise. A visible deletion inside a demoted field was absent from the ranges, so the caret could walk into deleted content
- [x] 6b.7 **A simple `PAGE` field painted the producer's cached number on every sheet.** `detectStoryPageFields` ignored `w:fldSimple` — harmless while they painted nothing, wrong once they paint — so the story's page key never varied. Detect them and evaluate live; a wrong page number is quieter than a blank, not smaller
- [x] 6b.8 Query cost on the keystroke path: addressed by 6b.1's class selector. Scoping further to the caret's own page would need the page index threaded in; not worth the coupling at this size

## 6c. The class, not the instances

Three separate bugs turned out to be one unstated invariant: **a painted span's text length is
not its model range.** A field is one offset and paints its whole result. Every consumer that
assumed 1:1 broke, each in its own way, and each was found only when a user hit it.

- [x] 6c.1 Sweep every offset-from-text-length site. The layout lane already guarded it
      (`semantic-hit-test.ts`, `semantic-interaction.ts` both compare against the range); the DOM
      lane did not
- [x] 6c.2 `dom-selection.ts` derived endpoints as `start + textContent.length` in four places,
      handing back offsets the paragraph does not have — a caret just after a field could not
      type. Carry the model `end` on `SpanIdentity` and clamp to the RANGE
- [x] 6c.3 The composition readback joined PAINTED text and diffed it against the model, so any
      IME edit in a field-bearing paragraph planned `deleteText` over the field plus `insertText`
      of its own rendering. Destructive, silent, permanent. Reconstruct model-space text from
      `data-docx-field`, which paint already emits — and NOT from the lengths disagreeing, which
      is what a real browser edit also looks like
- [x] 6c.4 `atomicFieldSpansOf` did not descend into inline content controls either, so a
      `w:fldSimple` in a `w:sdt` was one offset to layout and none to the store
- [x] 6c.5 State the invariant as a corpus oracle — `paragraph-offset-coverage.test.ts`: no span
      claims an offset the paragraph lacks, no ranges overlap, layout reaches the paragraph's end,
      and an unprojected span is 1:1 with its range
- [x] 6c.6 Baseline it honestly at 31 pre-existing content-control off-by-ones, identical to the
      count at the base commit, pinned so it cannot grow. Lowering it is a content-control change
      and wants its own proposal

## 6d. Second review round

Eight more, six of them introduced by the fixes above — which is the honest cost of widening a
walk that other code had been reasoning about. Each reproduced before being changed.

- [x] 6d.1 **The readback repeated a field's model characters.** The fix in 6c.3 emitted the model
      slice once per SPAN, and a result broken at word boundaries republishes one range across
      several spans — so a four-word field read back as four `￼` and the diff inserted the extras
      as literal object-replacement characters. Exactly the multi-span trap 6b.2 fixed elsewhere,
      reintroduced two commits later. Contribute each range once
- [x] 6d.2 A deleted simple `PAGE` painted its evaluated number into the proposed result: the
      live page-field branch bypasses the text collector where visibility was resolved
- [x] 6d.3 An inserted complex field painted in the ORIGINAL view. Latent until 6b/6c made
      `atomicFieldSpansOf` descend into revision wrappers, at which point such a field forms an
      atom and reaches a flush that never asked about visibility. The suppressed result run is
      skipped before it can donate its stack, so the capture has to happen at `begin`
- [x] 6d.4 The new `w:fldSimple` arm in the page-field detector returned for EVERY simple field,
      so a complex `PAGE` inside a `STYLEREF` stopped being found — the same failure the arm was
      added to prevent, one level down. Return early only when it is a page field
- [x] 6d.5 The `resultRevisions` doc still explained the design in terms of wrapped fields never
      forming atoms, which this change had already made untrue — and that stale reasoning is what
      hid 6d.3
- [x] 6d.6 `projectSimpleField` advanced an offset without recording a deleted range, so the caret
      was never told to step over a struck simple field
- [x] 6d.7 An orphaned doc comment had drifted onto the wrong function
- [x] 6d.8 `collapsedCaretPosition` promised more than it tested (focus, IME). Corrected the
      contract rather than the behaviour: Word keeps a field shaded while the caret is in it, and
      dropping the shading on every blur would flicker it away whenever the toolbar is used

## 7. Gates

- [x] 7.1 `bun run typecheck`, `bun run lint` (0 errors — the cap is the only thing that checks the extractions)
- [x] 7.2 `bun run test` — 6388 pass, 0 fail with the optional dependencies installed; against the baseline, 113 environment failures resolved and no regression
- [x] 7.3 `bun run api:extract` — additive only; export `FieldAtomMarker` and `FieldShadingMode` from their barrels so a consumer can name what the options take
- [x] 7.4 `bun run check:parity`, `bun run check:adapter-css-thin`, `bun run i18n:validate`
- [x] 7.5 `bun run format`
- [x] 7.6 Confirm on the reported document in the browser: the deleted `FORMTEXT` result paints struck through in the deletion colour with the insertion underlined beside it, matching Word; 19 form-field results shaded and the 8 ordinary fields not, under the `when-selected` default; the revision wash visibly outranks the shading; the `@media print` rule is present in the loaded stylesheet
- [ ] 7.7 Still unconfirmed in a browser: the caret-driven `--active` toggle. The engine gates caret updates on focus, and an automated tab is backgrounded (`document.hidden`), so the painted caret never moves and nothing can enter a field. Covered by unit tests over `syncActiveFieldShading`; needs one manual pass with a focused window, ideally on a document with a body-level `REF` or `PAGE` field (the reported one keeps its ordinary fields in furniture)
