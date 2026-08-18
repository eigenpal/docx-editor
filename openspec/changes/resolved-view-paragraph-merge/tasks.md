## 0. Baseline before code

- [x] 0.1 Record the `bun test` baseline for `packages/core`
- [x] 0.2 Reproduce the gap: a paragraph with a deleted mark followed by another lays out as two fragments in `proposed`, where accept-all gives one paragraph

## 1. Merge groups

- [x] 1.1 `markRemovedInMode(paragraph, displayMode)` in `revision-visibility.ts`, over the same kinds `markRevisionRemovesMark` names
- [x] 1.2 Group consecutive removals in `storyBlocks`, stopping at the last block of the container
- [x] 1.3 Build the synthetic paragraph: survivor `w:pPr`, members' content in order, survivor's node id
- [x] 1.4 Memoize the synthetic node with the cached block list, so pass-to-pass identity holds and the break cache still hits
- [x] 1.5 Tests: grouping per mode, the trailing-paragraph guard, a group of three, and a group interrupted by a table

## 2. Identity

- [x] 2.1 Publish a member boundary table with the synthetic node: member paragraph id, its length, its offset in the group
- [x] 2.2 Rewrite span, line and drawing ranges at the fragment publish sites in both lanes
- [x] 2.3 A span cannot straddle a member boundary — it is a piece of one run — so the remap CLAMPS to the member's length rather than publishing an offset past a real paragraph
- [x] 2.4 Tests: a merged fragment's spans name their own paragraphs; offsets round-trip against the store's text

## 3. Interaction

- [x] 3.1 Index a join line under every paragraph its spans name
- [x] 3.2 Build caret stops for a paragraph from that paragraph's spans alone
- [x] 3.3 Take document order from line identity
- [x] 3.4 Tests: hit testing both halves of a join line, caret walking across the join, selection rectangles spanning it

## 4. Editing through the merge

- [x] 4.1 Type at the join; assert the op names the first paragraph
- [x] 4.1b Type at the start of the second member; assert it stays in the second paragraph
- [ ] 4.2 Backspace at the start of the second member; assert it reaches the store as the join the tree already records
- [ ] 4.3 Undo restores both the tree and the merged rendering

## 4b. The store, found by building the layout side

- [x] 4b.1 `rebuildChildren` could not merge a paragraph forward once it had absorbed one, so a
      run of removed marks collapsed pairwise; it now tests the merge after absorbing
- [x] 4b.2 Store test: three consecutive deleted marks and a survivor become ONE paragraph

## 5. The oracle

- [x] 5.1 Extend the display-mode differential to mark cases: `proposed` equals accept-all, `original` equals reject-all, per line
- [x] 5.2 Run it over the tracked-changes corpus fixture
- [x] 5.3 Bench: merge groups must not change work counters on a document without tracked marks

## 6. Ship

- [ ] 6.1 `bun run test`, `typecheck`, `lint`, `format`, `api:check`
- [ ] 6.2 Changeset
- [ ] 6.3 `docs/site` word-features note: the resolved views merge, and what a reader sees

## 6b. What two OOXML reviews found, and what was done

- [x] 6b.1 `paragraphTextFromLayout` read the line whole, so BOTH members reported the other's
      text — and it is the surface's own `paragraphTextOf`, so the deletion range, the clamp
      and the word walk all followed it. Reads its own segment now
- [x] 6b.2 `selectionRects`, `keyedRangeRects` and `spansInSelection` resolved through
      `line.range`: a selection inside the second member painted nothing and read no
      formatting, one inside the first read the second's. All three go through `segmentOverlap`
- [x] 6b.3 A merged line's own range stopped at its first span when a member held several runs
- [x] 6b.4 A TRAILING run of removed marks did not collapse, where accept-all collapses it
- [x] 6b.5 Layout merged across a block `w:sdt`, where the store cannot. Grouping is per real
      parent now, so both halves refuse together — a merge Word performs and neither does
- [x] 6b.6 STORE: `followed` scanned every later sibling, so content merged into the paragraph
      AFTER a table and arrived behind it. It looks at the next block
- [x] 6b.7 `markRemovedInMode` matched on local name alone, so `<x:del/>` in the mark's `w:rPr`
      merged two paragraphs from markup any sender can author. The namespace is checked
- [x] 6b.8 A field whose `w:fldChar begin` and `end` straddle the mark closed ACROSS it once
      merged, swallowing the second member into one atomic offset. Refused instead
- [x] 6b.9 A member the walk over-publishes — content past a nesting cap — refused for the same
      reason: its characters cannot be read back at offsets the store can address

## 6c. What a third review found, and what was done

- [x] 6c.1 The namespace check reached only the innermost element, so `<x:rPr><w:del/></x:rPr>`
      still merged two paragraphs from markup any sender can author. Every step is checked
- [x] 6c.2 STORE: `followed` skipped a `w:sdt` the way it had skipped a `w:tbl`, so content
      merged into a paragraph in another parent and arrived behind the control
- [x] 6c.3 A click PAST the end of a merged line took its offset from the whole line and its
      paragraph from the segment, producing an offset the paragraph does not have
- [x] 6c.4 `fieldCharsBalanced` counted a net, so an `end` with no `begin` cancelled a later
      `begin` and a straddling field read as balanced
- [x] 6c.5 The measurement guard ran on every paragraph of every document, costing 12x on the
      default render path. It is asked only where a merge could happen
- [x] 6c.6 `lineAtPosition` never answered for the second member, so an inline image in the
      merged half could not be selected
- [x] 6c.7 Review anchors were keyed by `fragment.paragraphId`, so a card anchored in any
      member but the survivor dropped out of the rail
- [x] 6c.8 Backspace at a join carried the first paragraph's `w:del` onto a mark nobody edited.
      The break is invisible in a resolved view, so the key deletes a character instead
- [x] 6c.9 `bun run typecheck` passes across all eight packages; five dead symbols the
      extraction left behind are gone
- [x] 6c.10 The over-publish fixture asserted nothing: the refusal fires AT the nesting cap,
      not above it, where neither lane publishes the text

## 6d. What a verification pass against a real document found

Verified against `tracked-paragraph-marks.docx`: header, body, cell and a mark before a table.
All eight checks passed — merge, attribution, identity against `paragraphTextOf`, editing on a
mounted surface, caret and selection, the review rail, Accept All, and the save round-trip.

- [x] 6d.1 A delete ACROSS a merged break left the deleted mark on the survivor, so the next
      pass merged it into the paragraph after it and the rail kept a card for a mark that no
      longer exists. A join now carries the mark revisions of the paragraph whose mark
      survives, the way it already carried `w:sectPr`
- [x] 6d.2 Home and End stopped at the member boundary, in the middle of the visible line,
      because they were built from one paragraph's stops
- [x] 6d.3 Copying across the join put a newline in the clipboard, so one visible line pasted
      as two paragraphs
- [ ] 6d.4 The join still carries two caret slots at one painted position, so one arrow press
      does not move. Recorded at 7.7

## 6e. What a fourth, adversarial pass found

- [x] 6e.1 `deleteForward` had no rule for the invisible join, so Delete at the end of an
      absorbed member joined the paragraphs — and, with 6d.1 unfixed, swallowed the one after
- [x] 6e.2 The mark gate's `?? DEFAULT` was wrong for NOTE stories, which pass no mode and
      mean the resolved one: it lit up markup inside footnotes in the view that shows none.
      The gate requires an explicit mode again, and the story entry points name their own
- [x] 6e.3 `paragraphSectionIndexOf` indexed an All Markup block list with section bounds
      counted in the document's mode, so a tracked Enter renumbered a footnote in another
      section
- [x] 6e.4 `sectionFurniture` enumerated sections in All Markup while layout indexed them in
      the document's mode, pairing one section's pages with another section's header
- [x] 6e.5 The furniture memo's `displayMode` key compared a closure constant with itself. It
      is gone, and the field says a mode switch must rebuild the source
- [x] 6e.6 `moveFrom` and `moveTo` shared one card sentence, though accepting them does
      opposite things
- [x] 6e.7 The two declarations of `ReviewRevisionItem` had no drift gate. An optional field
      added to one and not the other passed every check; a compile-time identity assertion
      now fails instead
- [x] 6e.8 The measurement guard ran per candidate per flush — 19ms on a 380-mark document,
      every keystroke. Memoized on the paragraph node, which is immutable: 30ms cold, 2.9ms
      for the new part a keystroke publishes

## 7. Not done yet

- [ ] 7.1 Backspace and undo through a join (4.2, 4.3)
- [ ] 7.2 A merged group whose members carry different `w:pPr`: the survivor's properties are
      used, but no test pins alignment, indent or numbering across the join
- [ ] 7.3 Selection rectangles and `spansInSelection` across a join line
- [ ] 7.4 A merge whose members split across a page boundary
- [ ] 7.5 Note stories never receive a display mode at all (`note-layout.ts`), so the merge
      cannot reach them — a pre-existing gap the merge does not widen but does not close
- [ ] 7.6 Backspace at a join resolves the tracked mark with no visible change. Word's Final
      view deletes the preceding character instead; the rule wants deciding
- [ ] 7.7 The join carries two caret stops at one x, so Right-arrow crosses it in two presses
- [x] 7.8 Header and footer stories now pass the display mode to their BLOCK list, not only to
      the inline flow, so a tracked mark in a header merges and a removed paragraph leaves no
      blank line. The `fragment.paragraphId` readers it made live came with it: scoped document
      order and the paragraph-properties index read line identity now, and the paint fallback
      needs nothing because it only fires for a line with no spans, which a merged line never is
- [ ] 7.9 `w:pPrChange` is not honoured in `original`: the recorded properties are never
      restored, so a reformatted paragraph renders with its NEW formatting in the view that
      answers what the document was. Pre-existing, and invisible to the differential because
      the `original` assertion compares joined text rather than lines
- [ ] 7.10 The oracle covers the body story only, and only `w:del` on a mark. Neither the
      `original` direction of a merge, nor cells, nor a block `w:sdt`, nor headers, footers or
      notes are in the fixture. Run the line-for-line assertion for `original` too, and add a
      fixture carrying `w:ins` marks, a mark in a cell and a mark inside a `w:sdt`
- [ ] 7.11a A review item's id omits the part name, so a `w:id="1"` mark in the body and one
      in a header share a key — the React key, the active card, the dismissed set. Pre-existing,
      and reachable for the first time now that header marks are drawn
- [ ] 7.11b Consumers a sweep flagged and nobody has run end to end: `surface-structure.ts`
      `markerOf`, `semantic-cell-selection.ts` `collectParagraphs`, `note-pagination.ts`
      `filterRefsOnPage`, the card line-pick in `review-support.ts` and `docx-editor.ts`, the
      hand-rolled header/footer twin of `reviewAnchorIndex`, `semantic-paint.ts` line drawings,
      and `docx-editor-images.ts` drawing match. Each reads a fragment or a line whole
- [ ] 7.11 Enter inside the FIRST member copies the whole `w:pPr` onto both halves, so both
      carry the same `w:id`; accepting then collapses three paragraphs where Word gives two
