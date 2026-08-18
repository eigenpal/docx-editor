## 0. Baseline before code

- [ ] 0.1 Record the `bun test` baseline for `packages/core`
- [ ] 0.2 Reproduce the gap: a paragraph with a deleted mark followed by another lays out as two fragments in `proposed`, where accept-all gives one paragraph

## 1. Merge groups

- [ ] 1.1 `markRemovedInMode(paragraph, displayMode)` in `revision-visibility.ts`, over the same kinds `markRevisionRemovesMark` names
- [ ] 1.2 Group consecutive removals in `storyBlocks`, stopping at the last block of the container
- [ ] 1.3 Build the synthetic paragraph: survivor `w:pPr`, members' content in order, survivor's node id
- [ ] 1.4 Memoize the synthetic node with the cached block list, so pass-to-pass identity holds and the break cache still hits
- [ ] 1.5 Tests: grouping per mode, the trailing-paragraph guard, a group of three, and a group interrupted by a table

## 2. Identity

- [ ] 2.1 Publish a member boundary table with the synthetic node: member paragraph id, its length, its offset in the group
- [ ] 2.2 Rewrite span, line and drawing ranges at the fragment publish sites in both lanes
- [ ] 2.3 Assert no span straddles a member boundary, and refuse the merge rather than publish a compound offset if one ever does
- [ ] 2.4 Tests: a merged fragment's spans name their own paragraphs; offsets round-trip against the store's text

## 3. Interaction

- [ ] 3.1 Index a join line under every paragraph its spans name
- [ ] 3.2 Build caret stops for a paragraph from that paragraph's spans alone
- [ ] 3.3 Take document order from line identity
- [ ] 3.4 Tests: hit testing both halves of a join line, caret walking across the join, selection rectangles spanning it

## 4. Editing through the merge

- [ ] 4.1 Type at the join; assert the op names the first paragraph
- [ ] 4.2 Backspace at the start of the second member; assert it reaches the store as the join the tree already records
- [ ] 4.3 Undo restores both the tree and the merged rendering

## 5. The oracle

- [ ] 5.1 Extend the display-mode differential to mark cases: `proposed` equals accept-all, `original` equals reject-all, per line
- [ ] 5.2 Run it over the tracked-changes corpus fixture
- [ ] 5.3 Bench: merge groups must not change work counters on a document without tracked marks

## 6. Ship

- [ ] 6.1 `bun run test`, `typecheck`, `lint`, `format`, `api:check`
- [ ] 6.2 Changeset
- [ ] 6.3 `docs/site` word-features note: the resolved views merge, and what a reader sees
