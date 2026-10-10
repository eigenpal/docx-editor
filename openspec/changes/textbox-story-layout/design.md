# Design — Textbox Story Layout

## Context

A text-box drawing is a `wps:wsp` whose `wps:txbx` holds a `w:txbxContent`
story: ordinary paragraphs (and potentially tables) that flow inside the shape's
declared extent. Today three code points conspire to make that content
invisible:

- `projectVectorShape` returns null for any `wps:wsp` with a `wps:txbx` child
  (`store/package/drawing-projection.ts:1231`), so the drawing has neither a
  picture nor a vector-shape payload.
- `projectRunLevelMcDrawing` drops MC-wrapped drawings whose payload slots are
  both null (`drawing-projection.ts:1752`), and Word emits every `wps` shape
  inside `mc:AlternateContent` — so real-world text boxes vanish entirely
  instead of painting the labelled placeholder that a bare drawing would get.
- Story layout only flows top-level part blocks (`storyBlocks`), so field
  detection sees nested `PAGE` instructions but the nested paragraphs never
  reach layout.

The engine already contains every mechanism the feature needs:

- `layoutNoteStory` (`layout/note-layout.ts`) is a node-scoped nested-story
  layout: blocks collected from a node, flowed via `flowBlocksInBoxBounded` at a
  given width with a height bound, namespaced line ids, fragment caps, and a
  named fallback on truncation.
- `TableFlowDeps.pageContext` threads a `FieldPageContext` into
  `breakParagraph`, so `PAGE`-family fields substitute at layout time (digit
  widths affect measurement) — the same path direct footer fields already use.
- Header/footer layout already forces per-page variants when a story has
  anchored drawings (`hf-layout.ts` folds `|pn:` into the cache token), and body
  anchored drawings are resolved inside the per-page loop where
  `DrawingAnchorFrameContext.pageNumber` is known.
- Paint already re-bases page-relative header/footer anchors onto the page sheet
  (`output/semantic-paint.ts:305-325`) and paints container-relative fragments
  through `paintFragment`.

## Goals / Non-Goals

**Goals:**

- Anchored text boxes in body, header, and footer stories render their
  paragraph content inside the shape's extent, at the resolved anchor position,
  including behind-text and page-relative anchors.
- `PAGE`, `NUMPAGES`, and `SECTIONPAGES` fields inside textbox stories evaluate
  per page; cached field result text is never trusted.
- MC-wrapped text boxes render identically to bare ones; the VML fallback branch
  is never painted (no double rendering).
- `wps:bodyPr` insets (with OOXML defaults when absent), `wrap="square"` line
  wrapping at extent width, and vertical anchor (`t`/`ctr`/`b`) are honoured.
- Solid fill and outline of the hosting shape paint behind the story.
- All extraction and layout is bounded: nesting cap, fragment cap, height clip.

**Non-Goals:**

- Inline (`wp:inline`) textboxes — no fixture exercises them and the record
  plumbing differs; the layout module is shared, so they are a follow-up, not a
  redesign.
- Editing, selection, caret, or hit-testing inside textbox stories (painted as
  furniture, `contenteditable=false`, excluded from selection mapping).
- Linked textbox chains (`wps:linkedTxbx`) — the seq-0 box renders its own
  content; continuation boxes render empty rather than flowing overflow.
- `spAutoFit` / `normAutofit` height growth — extent is authoritative; overflow
  clips with a recorded fallback reason.
- Rotation, flips, WordArt, non-rect preset geometries as clip shapes, group
  shapes, charts, diagrams (placeholders stay).
- Serialization changes — the story is read from the canonical tree and never
  rewritten by this change.

## Decisions

**1. Third payload arm on `DrawingProjection`, not a new drawing kind.**
`textboxStory: TextboxStoryProjection | null` joins `picture` and `vectorShape`.
The projection captures the `w:txbxContent` node id (resolved through the node
index at layout time), the `bodyPr` reads (insets in EMU with the 91440/45720
defaults, vertical anchor, autofit mode for diagnostics), and the already-read
solid fill/outline of the shape. Alternative — reusing the placeholder path with
a side lookup — was rejected: every consumer switches on the payload arms, and a
first-class arm keeps freeze, digest, and paint dispatch honest.

**2. Extraction stores a reference; layout walks the content.** The drawing
walk's `maxVisitedElements` budget (4096 per drawing) must not be spent on story
paragraphs — a real story blows through it. `projectVectorShape` detects the
`txbx` child, records the content node, and skips the subtree; the blocks are
collected later by a node-scoped `textboxStoryBlocks` (sibling of
`noteStoryBlocks`) under layout's own caps. A new `MAX_TEXTBOX_STORY_NESTING`
(mirroring `MAX_TABLE_NESTING`) bounds textbox-in-textbox recursion, which was
previously unbounded only because the recursion never existed.

**3. Layout is a node-scoped story module shaped like `note-layout.ts`.**
`layoutTextboxStory(content, extent, deps)` flows blocks with
`flowBlocksInBoxBounded` at `extentWidth − insets`, `maxBottom` at
`extentHeight − insets`, truncating with a named fallback reason and a fragment
cap. `detectStoryPageFields(txbxContent)` gates whether the story participates
in per-page variants; a field-free textbox lays out once and is shared. Vertical
anchor offsets the fragment block inside the box after flow. Alternative — a
bespoke line layout — rejected; `flowBlocksInBoxBounded` already handles
paragraphs, tables, style cascade, and page context.

**4. Per-page values ride the existing variant machinery; no new projector.**
Header/footer stories with anchored drawings already relayout per page with a
`FieldPageContext`; body anchored drawings resolve inside the per-page loop with
`pageNumber` in hand. The textbox layout call simply receives the same
`pageContext` its host story was given. The one addition: a host story whose
*only* page fields live inside a textbox must still be classified as needing
per-page layout — `detectStoryPageFields` already sees nested instructions, so
this is already true for headers/footers; body drawings gain the equivalent
check where the drawing record is built.

**5. Paint mirrors the header/footer story container.** Each drawing with story
fragments paints an absolutely positioned, `overflow:hidden`, `contenteditable=false`
container at the record's paint bounds (page-relative HF anchors re-based like
today), fill rect and outline first, then fragments through the existing
`paintFragment`. No new text paint path; painted DOM stays a picture.

**6. VML dedup stays free.** MC branch selection already prefers the `wps`
Choice branch (its namespace is in the supported-requires set), so the VML
fallback never projects. No new suppression logic; a test pins it.

**7a. Attribute whitespace survives save (discovered during implementation).** The
serializer escaped markup characters but left CR/LF/TAB literal in attribute
values, which a conforming parser normalizes away on re-read — the multi-section
fixture's VML `o:gfxdata` attributes broke the save/reopen fingerprint oracle.
Attributes now escape CR/LF/TAB (and text nodes CR) as character references.

**7. Existing caps compose; two new limits only.** Zip/XML/part-scan caps are
upstream and unchanged. New: the story nesting cap, and a per-story block/
fragment cap (reusing the note-story pattern) so a hostile file cannot stuff one
drawing with unbounded paragraphs. All file-supplied numbers (extents, insets)
clamp through the existing EMU parsing.

## Risks / Trade-offs

- [Flipping the MC invisibility rule surfaces previously hidden drawings in
  existing documents] → It surfaces exactly the drawings Word shows; fixture
  oracles that pinned invisibility are updated deliberately in this change, and
  charts/diagrams/groups keep their current behaviour.
- [Per-page relayout of textbox-bearing footers costs layout time on long
  documents] → Bounded by the existing LRU page-context cache; a field-free
  textbox stays a single shared layout; stories are tiny (extent-clipped).
- [Skipping the txbx subtree in the drawing walk while later walking it in
  layout means two traversal regimes] → Each regime has its own explicit budget;
  the digest already treats the story as generic structure, so no oracle
  depends on the projection walking it.
- [Truncation differs from Word when content overflows a `noAutofit` box] →
  Word clips too; the fallback reason records truncation so fidelity review can
  find real divergences.
- [Read-only islands inside an editable page can trap selection gestures] →
  Containers are `contenteditable=false` furniture like page decorations and
  header/footer chrome in body mode; selection mapping already ignores nodes
  without `data-paragraph-id` bindings.

## Open Questions

- None blocking. Tables inside textbox stories come free from
  `flowBlocksInBoxBounded`; if a fixture surfaces a pathological case they can
  demote to the truncation fallback without a spec change.
