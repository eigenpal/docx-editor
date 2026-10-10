# Design

## What the spikes settled

**The store's merge keeps the SURVIVOR's properties.** `rebuildChildren` in
`tree-op-revisions.ts` carries the removed paragraph's content forward and prepends it to the
next paragraph's children, keeping that paragraph's `w:pPr`: "the surviving mark is this
paragraph's, so its properties govern the result." Layout must do the same or the two answers
drift, and the differential oracle is what would catch it.

**The interaction lane already keys on line identity, not fragment identity.**
`paragraphLinesIndex` indexes `line.range.paragraphId`, and caret stops, hit testing and
selection rectangles all read from that index. `fragment.paragraphId` is used in exactly one
place, `documentOrder`. This is why a merged group can publish one fragment without breaking
selection: what has to be right is the LINE and SPAN identity, and one field in document order.

**A resolved view is EDITABLE.** `docx-editor.ts` puts the free engine in `proposed` by
default. A merge that renumbered offsets into a compound paragraph would send every keystroke
in the merged half to an offset the store does not have. Identity is therefore not a
refinement of this change; it is the change.

**No span can straddle a member boundary.** A span is a styled piece of ONE run, and two
members contribute different runs, so the rewrite is a per-span remap and never a split.

## The one hard part

Layout does not use the store's offset authority. `piecesOfParagraph` runs its own walk with
its own running offset, documented as aligned with `paragraphTextOf` and `segmentsOf` but not
derived from it. A span records only `range`, `text` and `props` — it does not name the node it
came from.

So the member boundary cannot be assumed to equal the sum of the members'
`paragraphOffsetIndex(...).length`. Two ways to bridge it:

1. **Ask the walk.** `piecesOfParagraph` visits nodes in order and each piece knows its node.
   Recording the offset of the piece whose node is the first node of member `k` gives the
   boundary exactly, in the walk's own arithmetic, once per group per pass.
2. **Name the node on the span.** Add a source-node reference to `StyleSpanRecord` and rewrite
   through the store's `paragraphOffsetIndex`. Exact, and useful beyond this change, but it
   widens a published record and every consumer of it.

Take (1). It is contained to the layout lane, needs no record change, and it fails loudly:
if the first node of a member never appears in the walk, there is no boundary and the group
must refuse to merge rather than publish a compound offset.

## What this change does NOT do

It does not merge in `all-markup`, which is what the review module shows and where the break is
a decision the reader is being asked about. It does not change the store: `resolveRevisions`
already does this, and layout is catching up to it.
