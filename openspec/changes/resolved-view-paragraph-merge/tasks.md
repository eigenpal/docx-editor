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

## 7. Not done yet

- [ ] 7.1 Backspace and undo through a join (4.2, 4.3)
- [ ] 7.2 A merged group whose members carry different `w:pPr`: the survivor's properties are
      used, but no test pins alignment, indent or numbering across the join
- [ ] 7.3 Selection rectangles and `spansInSelection` across a join line
- [ ] 7.4 A merge whose members split across a page boundary
