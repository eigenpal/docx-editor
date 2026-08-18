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
