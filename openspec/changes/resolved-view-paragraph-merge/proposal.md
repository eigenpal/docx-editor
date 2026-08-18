## Why

A tracked change to a paragraph MARK is a change to a paragraph BREAK. `w:pPr/w:rPr/w:del` says the break was deleted, so accepting it runs the paragraph into the one after it; `w:pPr/w:rPr/w:ins` says the break was inserted, so rejecting it does the same. The store performs exactly that: `resolveRevisions` carries the content forward and keeps the survivor's `w:pPr`.

Layout does not. `proposed` and `original` are specified as equal to accept-all and reject-all OUTPUT, and for every other revision kind they are — deleted runs vanish, inserted runs appear. The mark is the one exception: both modes still show the break. A document where an author pressed Enter with tracking on renders as two paragraphs in a view whose entire purpose is to answer what the document becomes.

This is not a corner. `docx-editor.ts` puts the free engine in `proposed` BY DEFAULT — it is what every consumer without the review module sees — and that surface is fully editable. So the fix cannot be cosmetic. If two paragraphs are drawn as one, the characters of the second must still address the second paragraph in the live tree, or every click and keystroke in the merged half lands at an offset the store does not have.

Until now the mark at least drew a coloured pilcrow in those modes, which hinted that the break was disputed. Suppressing that attribution was correct — Word draws it in All Markup only — and it removed the last hint, so the two modes now show a break that the document says is not there.

## What Changes

**Merge groups, computed where blocks are enumerated**

- `storyBlocks(part, displayMode)` already drops a paragraph the mode removes entirely. It gains the other half: consecutive paragraphs where every member but the last has a mark the mode REMOVES become one merge group.
- Removal is mode-dependent and reuses the predicate the paint lane uses. In `proposed`, `w:del` and `w:moveFrom` remove the mark. In `original`, `w:ins` and `w:moveTo` do. In `all-markup`, nothing does.
- The last paragraph of a container never starts a group, matching the store's own guard: a merge with nothing to merge into would spill runs into `w:body`.

**One synthetic paragraph per group**

- The group lays out as a single paragraph carrying the SURVIVOR's `w:pPr` and every member's content in order — the same shape `resolveRevisions` builds, so the two answers cannot drift.
- The synthetic node is memoized with the block list, so its identity is stable across passes and the paragraph break cache still hits.
- Wrapping, list markers, borders, shading, page splits and cell flow need no changes: they see one paragraph, which is what the document means.

**Identity stays with the source paragraph**

- Every published span, line range and inline drawing keeps the paragraph id and the offsets of the member it came from. A span never spans two runs, and two members contribute different runs, so no span straddles a member boundary and the rewrite is a per-span remap with no splitting.
- A line holding the join carries content from two paragraphs. `LineRecord.range` names the paragraph of its first span; consumers that resolve a POSITION read span identity instead.
- `paragraphLinesIndex` indexes such a line under every paragraph its spans name, and caret stops for a paragraph consider only that paragraph's spans. Document order is taken from line identity rather than `fragment.paragraphId`, so a merged-away paragraph keeps its place in the order.

**The oracle**

- `proposed` output equals accept-all output, and `original` equals reject-all, compared as laid-out text per line. This is the existing differential harness; the mark cases are what it could not cover before.

## Impact

- Affected specs: `resolved-view-merge` (new).
- Affected code: `layout/story-roots.ts`, `layout/revision-visibility.ts`, `layout/semantic-interaction.ts`, the fragment publish sites in `layout/semantic-layout.ts` and `layout/semantic-table-layout.ts`.
- Editing is unaffected by construction: the store never sees a synthetic node, and every offset a surface reports names a live paragraph.
- Rendering changes in `proposed` and `original` only. `all-markup` is untouched, and it is what the review module shows.
