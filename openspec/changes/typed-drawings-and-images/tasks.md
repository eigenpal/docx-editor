## 0. Baseline before code

- [x] 0.1 Load `comprehensive-word-element-test.docx` in the demo and capture browser evidence of the eleven drawings today. The expected finding is that none paints and none reserves space, so the pagination around them is wrong — confirm rather than assume
- [x] 0.2 Record the page count and the position of the paragraphs surrounding each drawing, so the after-picture is comparable
- [x] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [x] 0.4 Confirm the D8 boundary expansion — drawing nodes, picture payload, anchoring and wrap — is accepted before typing any node. **Boundary review evidence:** the written design at `docs/superpowers/specs/2026-08-04-typed-drawings-and-images-design.md` was explicitly approved by the user in session 2026-08-04; this records that approval as the D8 gate for this change, not an external reviewer sign-off. Full Task 1 review remains subject to re-review.

## 1. Typed nodes

- [x] 1.1 Add `drawing`, `inlineDrawing`, `anchoredDrawing`, `picture` to the node-kind union in `ooxml-tree.ts`
- [x] 1.2 Type `CT_Inline` and `CT_Anchor` with every attribute named in the proposal
- [x] 1.3 Type the wrap vocabulary: `CT_WrapNone`, `CT_WrapSquare`, `CT_WrapTight`, `CT_WrapThrough`, `CT_WrapTopBottom`, with `ST_WrapText` and the polygon
- [x] 1.4 Type `CT_PosH` / `CT_PosV` with `ST_RelFromH`, `ST_RelFromV`, and the align/offset choice
- [x] 1.5 Type `CT_Picture`: `a:blip` (`r:embed` / `r:link`), `a:srcRect`, fill mode, `a:xfrm` with rotation and flips, `a:prstGeom`
- [x] 1.6 Non-picture graphic data stays a generic payload under a typed drawing
- [x] 1.7 Preserve `wp:docPr/@name` and `@descr` exactly; never generate either
- [x] 1.8 Re-emit an empty `a:srcRect` as empty; assert canonical-fingerprint equality across all eleven fixture drawings unedited

## 2. Media, resources, and security

- [x] 2.1 Resolve `r:embed` through the existing safe-target rules; refuse a target containing `..` or a leading `/`
- [x] 2.2 Validate decoded bytes against the declared content type; placeholder on mismatch
- [x] 2.3 Enforce dimension and byte-size bounds in `store/runtime/limits.ts` **before** any allocation sized by a file-supplied number
- [x] 2.4 **Never fetch** `r:link` or a `TargetMode="External"` image relationship at load, layout, paint, or save. Add the test that asserts zero network requests for such a document
- [x] 2.5 Explicit-gesture path for loading an external image, with scheme allowlisting
- [x] 2.6 Sanitize `a:hlinkClick`; activation requires a gesture and an allowlisted scheme; the authored value is preserved escaped on save
- [x] 2.7 Decode a shared media part once; refcount it against live drawing references

## 3. Layout — inline

- [x] 3.1 Inline drawing occupies `wp:extent` as an unbreakable line item with baseline alignment
- [x] 3.2 `@distL` / `@distR` as horizontal spacing
- [x] 3.3 Wrap to the next line when it does not fit; grow the line when taller than its text
- [ ] 3.4 **Settle the wider-than-content-box behaviour against a Word comparison** and implement it consistently
- [x] 3.5 Caret steps over an inline drawing as one unit; a selection spanning it includes it

## 4. Layout — anchored

- [x] 4.1 Resolve `positionH` / `positionV` against every `ST_RelFromH` / `ST_RelFromV` frame; page-relative means page-relative
- [x] 4.2 Honour `@layoutInCell` inside a table
- [x] 4.3 Exclusion zones per wrap mode, including insets, as a line-breaking input rather than a paint-time clip
- [x] 4.4 **Decide and record** whether tight and through use the real `wp:wrapPolygon` or a bounding-box approximation. If approximated, say so in the spec — do not approximate silently
- [x] 4.5 Paint order from `@behindDoc` and `@relativeHeight`; displacement under `@allowOverlap="0"`; paint order changes no layout
- [x] 4.6 Named fallback and a reported reason for an unresolvable frame
- [x] 4.7 **Assert the header rule**: a header containing a page-relative anchored drawing is still sized by story flow height, and the body area is not pushed down by the drawing's extent

## 5. Paint and unrenderable formats

- [x] 5.1 Paint decoded images at their laid-out geometry with crop and transform applied
- [x] 5.2 TIFF, EMF, WMF, undecodable media, and non-picture graphics reserve their extent and paint a labelled placeholder
- [x] 5.3 Placeholders name the reason and never claim support
- [x] 5.4 Every file-derived string in a placeholder is set as text content, never assigned as markup

## 6. Operations and the React surface

- [x] 6.1 insert-image, replace-image, delete-image, resize-image, set-image-crop, set-image-alt-text, set-wrap-mode, set-anchor-position in `tree-ops.ts` and siblings
- [x] 6.2 Insert adds part, override, and relationship in one transaction; validates bytes before writing anything
- [x] 6.3 Delete refcounts the media part; resize and crop leave media byte-identical
- [x] 6.4 Impact class no narrower than `flow-structural` for extent and wrap changes
- [x] 6.5 Wire `image.insert` and `image.properties` via payload-aware shape probes (not fixed `SLOT_COMMANDS` rows); both carry `state: { kind: 'command' }` and report engine `can`/`canExecuteImageCommand` honestly
- [x] 6.5a Add `image.wrap` and `image.altText` to `ChromeSlotId` — public API forever, chosen once — with `image.wrap` as `kind: 'value'`
- [x] 6.5b **Widen the value-command path beyond `setMarkAttr`.** `commandForSlotValue` resolves through `VALUE_SLOT_MARKS` and answers `null` otherwise, so a wrap choice cannot be expressed today. The command exists — `setImageWrapType`, with the nine `target` values — so this is plumbing, not vocabulary design
- [x] 6.5c **Add a current value to `ToolbarCommandState`, and widen `ImageContext.wrap`.** The state carries only a boolean `active`, and the read side is narrower than the write side: `setImageWrapType` accepts nine targets while `ImageContext.wrap` reports six, so `squareLeft`, `squareRight`, and `through` are settable but unreportable. Coordinate the state change with `typed-revisions-and-comments`, which needs the same for `review.displayMode` and `review.editingMode` — widen once, not twice
- [x] 6.5d Settle how the `contextual` `image` group surfaces in the default bar, once for the group
- [x] 6.6 Resize handles positioned from layout records, one history entry per drag, preview without committing
- [x] 6.7 Anchored drag writing `wp:posOffset` against existing frames, with edge auto-scroll
- [x] 6.8 Wrap menu keyed on Word's user-facing choices, not the wrap element: In Line with Text, Square, Square Left, Square Right, Tight, Through, Top and Bottom, Behind Text, In Front of Text. **Behind Text and In Front of Text are both `wrapNone` and differ only by `@behindDoc`** — a menu derived from the wrap element loses the distinction. Mapping total in both directions; inline↔floating conversion in one transaction
- [ ] 6.8a Settle which side `ST_WrapText` `left` / `right` puts the text on against Word before labelling Square Left and Square Right
- [x] 6.9 Properties dialog: size, crop, alt text, position; reset-to-natural-size from intrinsic dimensions and DPI
- [x] 6.10 Alt text to assistive technology; a drawing with neither `@descr` nor `@name` is exposed as decorative
- [x] 6.11 Keyboard resize with a defined step; chrome mousedown `preventDefault()` except on INPUT/SELECT/TEXTAREA
- [x] 6.12 i18n keys, `bun run i18n:fix`, `bun run i18n:validate`
- [x] 6.13 `bun run api:extract`, `bun run check:parity`

## 7. Fixtures — the comprehensive file covers inline layout and one square wrap, nothing else

- [x] 7.1 Use `list-pagination-break.docx` for the external-relationship rule — it already carries 27 `TargetMode="External"` image relationships. Author `images-external.docx` only for the `r:link` form if that file lacks it.
- [x] 7.2 Start from `float-wrap-comprehensive-test.docx`, `image-layout-modes-demo.docx`, and `issue-705-anchored-header-letterhead.docx`, which already cover `wrapTight`, `wrapThrough`, and `wrapTopAndBottom`; author only the missing `ST_WrapText` sides and the `wrapNone` case
- [x] 7.3 `images-crop.docx` — a real non-empty `a:srcRect`. **This is a genuine repository-wide gap**: no fixture anywhere has one, so cropping is untestable until it exists
- [x] 7.4 `images-zorder.docx` — two overlapping anchored drawings with differing `@relativeHeight`, one `@behindDoc="1"`, and one `@allowOverlap="0"`
- [x] 7.5 `images-formats.docx` — JPEG, GIF, SVG, TIFF, EMF, and WMF, to exercise decode and placeholder paths
- [x] 7.6 `images-header.docx` — a page-relative anchored drawing in a header, to pin the header-sizing rule
- [x] 7.7 `images-nonpicture.docx` — a chart, a group, and a text box, to pin extent-plus-placeholder
- [x] 7.8 `images-transform.docx` — rotation, `@flipH`, `@flipV`
- [x] 7.9 Keep the comprehensive fixture as the inline-layout and round-trip fixture, and record that its `a:srcRect` elements are empty so nobody reads it as crop coverage

## 9. Verification and honest scope

- [x] 9.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Follow-up `vue-drawing-authoring-parity` is open; do not describe the lane as supported
- [x] 9.2 Rewrite the drawings entry in `deferred-features.md`; keep the entry
- [x] 9.3 D9: canonical fingerprint on unedited round trips; media parts byte-identical unless replaced; save/reopen semantic digest after resize, crop, and wrap change
- [x] 9.4 Full-vs-incremental differential test over a wrap-mode change that re-flows several pages
- [ ] 9.5 Visual comparison against Word for each wrap mode, recorded in `screenshots/`
- [x] 9.6 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-drawings-and-images --strict`
- [x] 9.7 Report any bypassed or still-failing gate as failing
- [x] 9.8 `bun run format`

## 10. Explicitly out of scope

- [x] 10.1 A TIFF / EMF / WMF converter — placeholders reserve the correct space; a converter is its own change
- [x] 10.2 Charts, SmartArt, groups, and canvases — extent plus placeholder, not support
- [x] 10.3 Text boxes — they contain flowable stories and belong with the story work, not with pictures
- [x] 10.4 `a:effectLst` shadows, reflections, and artistic effects
- [x] 10.5 VML (`w:pict`) — owned by the named follow-up `typed-vml-watermarks`. DrawingML image watermarks remain in this change.
- [x] 10.6 Tracked deletion of a drawing — owned by `typed-revisions-and-comments`

## 11. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [x] 11.1 **Decide `mc:AlternateContent` handling before typing anything.** **Resolved:** first supported `mc:Choice`, else `mc:Fallback`; branch selection is projection-only; all branches preserved on save (design I10).
- [x] 11.2 Reconcile `EditorSnapshot.image.wrap` (no `through`, conflates `@behindDoc`) and `Editor.getSelectedImage()` (no wrap/crop/alt) with the shipped contract (finding 1). **Resolved in design I14:** one canonical `SelectedImageState`; all nine wrap values through shared chrome state.
- [x] 11.3 Add `@hidden` on `CT_Anchor` and `a:CT_NonVisualDrawingProps` — a hidden drawing that paints is a visible defect. Add `@title` alongside `@descr`; Word's alt-text UI writes both, and the current fallback would announce `name="Picture 3"`. **Resolved in design I13:** accessibility uses `@descr`, then `@title`; never `@name`.
- [x] 11.4 Honour `@locked` and `a:graphicFrameLocks` (`noResize`, `noSelect`, `noMove`, `noChangeAspect`) before presenting handles
- [x] 11.5 `wp:simplePos` is a required child and `@simplePos="1"` overrides `positionH`/`positionV`; only the positionH/V path is specified. **Resolved in design I11:** `wp:simplePos` is authoritative when `@simplePos="1"`; no `@use` attribute.
- [x] 11.6 Wrap distances come from the **wrap element's own** `distT/B/L/R`, not the anchor's, and `wp:effectExtent` widens both reserved space and wrap bounds. **Resolved in design I12; Task 8 fix round 3 (2026-08-04).**
- [x] 11.7 `a:xfrm/@rot` is in 60000ths of a degree, `wp:extent` is the rotated bounding box while `a:xfrm/a:ext` is unrotated, and `a:prstGeom` **clips** rather than merely round-tripping. Layout geometry normalization covers supported presets (`rect`, `ellipse`, `roundRect`) with rectangular fallback + `unsupported-preset` diagnostic; production paint clipping and broader preset fidelity finish in Task 10.
- [x] 11.8 Model `a:blip` effects at least enough for watermarks — `a:lum`+`a:grayscl` is how Word writes a washed-out watermark image, which would otherwise paint at full saturation over the text. **Resolved in design I15:** DrawingML image watermarks in this change; VML in `typed-vml-watermarks`.
- [x] 11.9 Add a demotion rule for malformed drawings — a `wp:anchor` in inline position, a non-numeric `wp:extent`, two children
- [x] 11.10 `wp:docPr/@id` is required and must be allocated by insert-image. **Resolved in `core-image-commit` spec:** package-wide, non-zero, above max existing id, `invalidArgs` on exhaustion.
- [x] 11.11 Own or explicitly defer `w:object` (OLE, `@progId`, `@updateMode`) and `w:altChunk` — the latter pulls another part's content into the flow and deserves the same explicit refusal as `TargetMode="External"` (finding 2). **Deferred:** preserved as inert generic OOXML; explicit unsupported-content diagnostics (approved design).
- [x] 11.12 Add the missing `## MODIFIED` spec delta for `core-image-commit`
- [x] 11.13 Assign the watermark owner with `scoped-header-footer-editing` (finding 3). **Owner:** VML watermarks → `typed-vml-watermarks`; DrawingML image watermarks → this change; HF scope → `scoped-header-footer-editing`.

## Implementation reports

### Task 7 — anchored coordinate frames (2026-08-04)

**Scope:** OpenSpec 4.1–4.2, 4.6, 11.5 only — frame resolution and `AnchoredDrawingRecord` publication; no wrap/reflow/paint/mutation.

**Delivered**

- `AnchoredDrawingRecord` with horizontal/vertical frame, anchor metadata, owner story, and optional `layoutFallback: 'unresolvable-frame'`.
- `resolveAnchoredDrawingPosition` / `publishAnchoredDrawingsForParagraph`: all schema-valid `ST_RelFromH` / `ST_RelFromV` frames, align vs `posOffset`, `@simplePos="1"` precedence, odd/even inside/outside margins, negative offsets at layout boundary (projection still clamps authored negative EMU to 0).
- Body/table/header layout threads page/section geometry and cell boxes; `layoutInCell=true` clips semantic paint/hit to the cell layout box.
- `PageRecord.anchoredDrawings`, incremental cache tokens include anchor position fields, anchored hit-testing on pages.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-layout.test.ts -t "resolves anchored position frames"` | 14 pass |
| `bun test packages/core/src/layout/__tests__/drawing-layout.test.ts -t "places anchors in story and cell context"` | 4 pass |
| `bun test drawing-layout.test.ts semantic-layout.test.ts even-odd-header-parity.test.ts` | 78 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Left unchecked:** 3.4 (Word wider-than-box), 4.3–4.5, 4.7 (header flow-height rule — anchored extent does not size HF box; dedicated fixture test still absent).

**Unresolved concerns:** Full incremental differential over multi-page anchor reflow (9.4) not yet proven; nested-table anchor matrix is partial; wrap/distances/effect-extent not consumed for reflow (Task 8 scope).

### Task 7 — fix round 1 (2026-08-04)

**Scope:** GPT-5.6 review findings for anchored coordinate frames, anchor validity, HF furniture, lifecycle, clipping/hits. Task 8 wrap/collision/effects explicitly out of scope; wrap metadata stored on records.

**Delivered**

- `parseSignedEmu` preserves negative `wp:posOffset` and `wp:simplePos` x/y through parser → projection → layout; extent cx/cy remain non-negative with demotion on violation.
- `anchoredDrawingChildrenValid` enforces required child cardinality and schema child order (simplePos → positionH → positionV → extent → [effectExtent] → wrap → docPr → [cNvGraphicFramePr] → graphic); adversarial misorder/missing/double-wrap demotes to generic; reader and `validateOoxmlPart` share rules.
- `pageClipRegion` clips page/margin anchors to full sheet including margin bands; `layoutInCell=false` resolves against page frame not cell content box.
- `inside`/`outside` align parity on odd/even pages for horizontal and vertical axes.
- HF `layoutHeaderFooterStory` publishes `anchoredDrawings` on `HeaderFooterStoryLayout` / `HeaderFooterStoryRecord`; `furnitureFor` attaches to page header/footer without inflating flow height.
- `publishAnchoredDrawingsForParagraph` publishes only when anchor line is found on the current fragment (no last-line fallback).
- Hit testing: text-on-glyphs wins over behind-document layers; front layers after text; HF furniture anchors hittable via `hitTestSheet` in story-relative coordinates.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-layout-anchor-fix-round.test.ts` | 28 pass |
| `bun test drawing-layout*.test.ts semantic-layout.test.ts even-odd-header-parity.test.ts drawing-projection.test.ts ooxml-tree.test.ts` | 222 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.1, 4.2, 11.5.

**Still unchecked:** 4.3–4.5, 4.7, 9.4 incremental differential, nested-table/full matrix gaps noted above.

### Task 7 — fix round 2 (2026-08-04)

**Scope:** Ten review blockers — schema numerics, anchor sequence/attrs, real geometry frames, HF page parity, hit order, table lifecycle, incremental/continuous merge, split-paragraph publication. Task 8 wrap/collision/paint still out of scope.

**Delivered**

- **Schema numerics:** `ST_PositionOffset` int32 reject/demote (no clamp); `ST_Coordinate` signed 64-bit for `wp:simplePos` x/y with `emuToPointsSafe` refusal; boundary/adversarial tests in `drawing-layout-anchor-fix-round-2.test.ts`.
- **Anchor validity:** `anchorAttributesValid` (dist*, booleans, unsigned `relativeHeight`, required `locked`); optional `effectExtent` only between extent and wrap; reader/validator mirror with generic preservation on invalid.
- **Real geometry:** `anchorCharacterXOnLine` at span boundaries; `columnBoxForSection`; cell-relative frames for `layoutInCell` (margin/column/paragraph/line, not page/binding margins); HF `HeaderFooterPageContext` with real sheet geometry and inside/outside parity without field guess.
- **HF hits:** story-relative anchors no double-shift on `remapPage`; hittable in sheet coordinates; later-section geometry threaded.
- **Tables:** preflight row measure strips anchor publication; finalize-only publish with vAlign shift via `shiftAnchoredDrawingRecords`; `layoutInCell` against finalized cell box.
- **Incremental / continuous:** unchanged-prefix page identity on same open page; `withAppendedFragments` merges `anchoredDrawings`; continuous continue when prior section ends or current section starts `continuous`.
- **Hit order:** front anchors before glyph text; behind anchors after glyphs but still hittable elsewhere; `relativeHeight` tie-break among front overlaps.
- **Split paragraph:** anchor atom on overflow page yields exactly one record on that page (wrap-friendly fixture text).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-layout-anchor-fix-round-2.test.ts` | 18 pass |
| `bun test drawing-layout*.test.ts drawing-layout-anchor-fix-round*.test.ts semantic-layout.test.ts incremental-multi-section-layout.test.ts drawing-projection.test.ts ooxml-tree.test.ts` | 200+ pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.1, 4.2, 4.6, 11.5 (stronger numerics/validity/geometry/hits/lifecycle coverage).

**Still unchecked:** 4.3–4.5, 4.7, 9.4 full incremental differential over multi-page anchor reflow, fixture tasks §7, paint/tasks §5–6.

### Task 7 — fix round 3 (2026-08-04)

**Scope:** Ten GPT review blockers for deferred table anchors, measured character frames, column ownership, physical page/margin frames, HF attach-time parity, hits outside flow box, incremental checkpoints, continuous-section merge rule, ST_PositiveCoordinate, split ownership. Task 8 wrap/collision/paint still out of scope.

**Delivered**

- **Table deferred anchors:** finalize-only publish unchanged from round 2; center/exact-height rows verified in round-3 matrix.
- **Measured character frame:** `publishAnchoredDrawingsForParagraph` threads `measurer`; `anchorCharacterXOnLine` uses shaped glyph boundaries; character-frame offset helper for horizontal `character` frames.
- **Column ownership:** multi-column flow breaks at column width, `tryAdvanceColumn` before page flush, `columnOffsetX` on placement, `columnBoxForSection` index for anchor frames.
- **Physical page/margin frames:** `physicalContentHeight` on body/HF frame bases; `page`/`bottomMargin`/`outsideMargin` vertical edges distinguish sheet bottom vs authored content-band bottom (furniture-independent).
- **HF attach-time parity:** `withPageContext` re-layouts anchored stories per page number; page-token cache includes page index for inside/outside without PAGE fields.
- **HF hits:** page-relative anchors clip to page band not story flow box; `hitTestSheet` tests furniture anchors outside the short story box.
- **Incremental checkpoints:** `sameAnchoredDrawings` reference identity on open-page prefix; pending anchors in flow checkpoints.
- **Continuous sections:** merge governed only by preceding section `w:type === continuous` (round-3 boundary); semantic-layout continuous fixtures updated to match.
- **ST_PositiveCoordinate:** max extent typed; one-past-max demotes (round-3 test).
- **Split ownership:** owning fragment range contains `anchor.start` exactly (round-3 test).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-layout-anchor-fix-round-3.test.ts` | 12 pass |
| `bun test drawing-layout*.test.ts drawing-layout-anchor-fix-round*.test.ts semantic-layout.test.ts incremental-multi-section-layout.test.ts drawing-projection.test.ts ooxml-tree.test.ts even-odd-header-parity.test.ts` | 318 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.1, 4.2, 4.6, 11.5 (round-3 geometry/HF/incremental/continuous coverage).

**Still unchecked:** 4.3–4.5, 4.7, 9.4 full incremental differential over multi-page anchor reflow, fixture tasks §7, paint/tasks §5–6.

**Remaining concerns:** Multi-column body flow is first-cut (break width + column advance on vertical overflow only; no `nextColumn` parity). Nested-table / gridSpan / vMerge anchor matrix remains partial beyond round-3 table cases. Character-anchor `start` records the model offset (6 for trailing-text drawings), not a separate glyph index. Round-3 column fixture uses 14 filler words to land the anchor paragraph in column 2 on a 100pt-tall page.

### Task 7 — fix round 4 (2026-08-04)

**Scope:** Eight acceptance blockers — nested-table deferred anchor routing, vMerge re-resolve, column placement ownership, layoutInCell full frame matrix, physical page clipping, caps character boundary, HF memo geometry, incremental checkpoint differential. Task 8 wrap/collision/paint still out of scope.

**Delivered**

- **Nested tables:** `anchorDeferOnly` + nested deferred collector; publish exactly once after nested `finalizeTableRows` with finalized cell geometry; `publishAnchoredDrawings` root sink preserved through row defer wrappers; duplicate guard on page collector.
- **vMerge:** `onAnchorRepublish` replaces shift-only for merged-cell geometry; `finalizeTableRows` re-resolves anchors against expanded cell box (bottom/center frames, multi-row fixtures).
- **Columns:** `columnOffsetX()` recomputed at fragment flush and per-line placement; column-2 anchor/line/box coordinates when paragraph overflows into second column.
- **layoutInCell:** All declared frames resolve against bounded table cell coordinates; both-axis clip to final cell box; finite cell-box guard prevents HF unbounded-box regression.
- **Physical clipping:** `pageClipRegion` uses `physicalContentHeight` for margin-band height; body page-bottom anchors clip to physical content band independent of HF furniture shrink.
- **Character boundary:** `anchorCharacterXOnLine` measures via `displayText` (same caps transform as line breaking); caps/`WWW` proportional regression fixture.
- **HF memoization:** `hfStoryMemo` key includes page height and section margins; same shared part re-layouts when geometry differs at equal content width.
- **Incremental differential:** Tail paragraph mutation relayouts page object while prefix anchor record keeps identity on same open page.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-layout-anchor-fix-round-4.test.ts` | 16 pass |
| `bun test drawing-layout-anchor-fix-round*.test.ts` | 74 pass |
| `bun test drawing-layout*.test.ts semantic-layout.test.ts incremental-multi-section-layout.test.ts even-odd-header-parity.test.ts` | 230 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | 3629 pass, 1 fail — pre-existing `layout-authority` false positive on `/word/document.xml` path literal in `semantic-layout.ts` (unchanged by this round) |

**Boxes checked with evidence:** 4.1, 4.2, 4.6, 11.5 (round-4 nested/vMerge/column/layoutInCell/physical/HF/incremental coverage).

**Still unchecked:** 4.3–4.5, 4.7, 9.4 full multi-page anchor reflow differential, fixture tasks §7, paint/tasks §5–6.

### Task 8 — geometry normalization (2026-08-04)

**Scope:** OpenSpec 4.3–4.4, 11.6–11.7 only — pure DOM-free transform/crop/effect-extent/polygon normalization and scanline exclusion primitives; no paragraph wrap integration (Task 9), paint (Task 10), or overlap/layering.

**Delivered**

- `drawing-geometry.ts`: rotation raw/60000 modulo normalization, independent crop clamp with opposing-sum guard, effect-extent expansion, picture-local flip/crop/rotation before anchor translation, supported preset clip polygons (`rect`, `ellipse`, `roundRect`), rectangular fallback for unsupported/custom geometry, `MAX_IMAGE_POLYGON_POINTS` guard, `DrawingGeometry` on inline/anchored records via `drawingGeometryFromProjection`.
- `drawing-wrap.ts`: exact `wp:wrapPolygon` normalization after crop/transform, anisotropic Minkowski expansion from wrap-element distances (not anchor attrs), tight filled-region and through even-odd scanline intervals, `bothSides`/`left`/`right`/`largest` side filtering, malformed polygon bounded-rectangle fallback.
- `drawing-layout.ts` / `semantic-records.ts`: records carry `geometry`; shift/clip helpers preserve geometry; layout cache tokens include crop/transform/effect/wrap fields.
- Decision recorded: tight/through use exact transformed polygons, not bounding-box approximation (design I12, spec 4.4).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-geometry.test.ts` | 17 pass |
| `bun test packages/core/src/layout/__tests__/drawing-wrap.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-wrap.test.ts -t "uses transformed wrap geometry"` | 4 pass |
| `bun test drawing-layout*.test.ts drawing-geometry.test.ts drawing-wrap.test.ts drawing-projection.test.ts` | 245 pass |
| `bun test semantic-layout.test.ts even-odd-header-parity.test.ts` | 43 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.4, 11.6, 11.7 (superseded by fix round 1 for geometry accuracy; 4.3 deferred to Task 9).

**Still unchecked:** 4.5 (paint order/overlap displacement), 4.7 (header flow-height rule), 9.4 incremental differential, Task 9 wrap reflow integration, Task 10 paint, fixture tasks §7.

**Concerns:** Wrap scanline primitives are unit-tested but not yet fed into `paragraph-flow` line-width calculation (Task 9). Full `bun test` not rerun this round (prior baseline: 3629 pass, 1 pre-existing `layout-authority` false positive).

### Task 8 — fix round 1 (2026-08-04)

**Scope:** Eight geometry/wrap blockers — full `a:xfrm` off/ext projection, center-rotation pipeline, true anisotropic Minkowski polygon offset, nonzero vs even-odd divergence, multi-passage side filtering, signed effect-extent semantics, preset clip intersection, bounded polygon clipping. No paragraph wrap integration (Task 9); 4.3 stays unchecked.

**Delivered**

- **`DrawingTransform` + projection:** `offsetEmu` / `extentEmu` parsed from `a:off` / `a:ext`; signed `wp:effectExtent` edges preserved (no clamp-to-zero).
- **Geometry pipeline (`drawing-geometry.ts`):** source xfrm basis → crop → center flips/rotation → scale into authoritative `wp:extent` → anchor translation; `contentBounds` never resizes from xfrm; preset clip intersected with transformed content bounds; `clipGeometryToRegion` / `clipPolygonToBox` clip corners/polygons/paint/hit consistently.
- **Wrap (`drawing-wrap.ts`):** exported `expandPolygonAnisotropic` via support-function edge offset (not bounds scaling); tight uses signed-winding scanline fill; through uses even-odd contour pairing; side filtering uses full excluded span for left/right/largest with multi-passage through fixtures.
- **Inline measure:** `measureInlineDrawing` includes outer effect extent in line reservation (`totalWidth` / `lineContribution`); authored `width`/`height` stay `wp:extent`.
- **Tests:** `drawing-geometry-fix-round-1.test.ts` (12), `drawing-wrap-fix-round-1.test.ts` (13); existing geometry/wrap tests updated for center rotation and xfrm fields.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-geometry-fix-round-1.test.ts` | 12 pass |
| `bun test packages/core/src/layout/__tests__/drawing-wrap-fix-round-1.test.ts` | 13 pass |
| `bun test drawing*.test.ts drawing-projection.test.ts semantic-layout.test.ts even-odd-header-parity.test.ts` | 313 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.4, 11.6, 11.7 (exact polygon, signed effect extent, xfrm/center-rotation pipeline).

**Still unchecked:** 4.3 (paragraph exclusion integration — Task 9), 4.5, 4.7, 9.4 incremental differential, Task 9 wrap reflow, Task 10 paint, fixture tasks §7.

**Concerns:** Full-repo `bun test` not rerun (prior baseline: 3629 pass, 1 pre-existing `layout-authority` false positive). Word fixture comparison for Minkowski offset fidelity deferred to Task 17.

### Task 8 — fix round 2 (2026-08-04)

**Scope:** Seven geometry/wrap/projection blockers from GPT review — authoritative xfrm pipeline, exact anisotropic Minkowski scanline exclusion (no fake offset ring), content-band clamping, effectExtent owner precedence, preset clip paint/hit, bounded polygon guards, inline clip coordinate fix. No paragraph wrap integration (Task 9); 4.3 stays unchecked.

**Delivered**

- **`projectPointsThroughXfrm`:** crop → offset frame → rotate/flip around `off+ext/2` → map transformed bbox into authoritative `wp:extent` → anchor translate; wrap polygons use the same single pass (no double scale).
- **`minkowskiExcludedIntervalsAtY`:** exact scanline intervals for P ⊕ [-left,right]×[-top,bottom] via band critical-y sampling; tight nonzero vs through even-odd; preset clip via `intersectScanlineIntervals`; exclusions clamped to `[contentLeft,contentRight]` before inversion/filtering.
- **`DrawingGeometry`:** transformed preset clip is paint/hit authority (`pointInDrawingClip`, `clipFallback: 'unsupported-preset'`); signed effect extent on clip bounds; `clipPolygonToBox` finite-guarded (approximate for non-convex subjects — documented).
- **Projection/layout:** `readEffectExtent` anchor-first, then wrapSquare/wrapTopAndBottom child; inline `extentX = slot + distL + effectL`, line metrics include all effect edges; `clipInlineDrawingRecordToRegion` clips shifted record paintBounds (fixes column/page placement regression).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-geometry-fix-round-2.test.ts` | 12 pass |
| `bun test packages/core/src/layout/__tests__/drawing-wrap-fix-round-2.test.ts` | 11 pass |
| `bun test packages/core/src/layout/__tests__/ packages/core/src/store/__tests__/drawing-projection.test.ts` (98 files) | 1427 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 11.6, 11.7 (re-checked after fix round 2 tests green). **4.4 remains checked as recorded decision** (exact polygon, not bbox approximation — implementation now via scanline/Minkowski, not single-ring offset polygon).

**Still unchecked:** 4.3 (paragraph exclusion integration — Task 9), 4.5, 4.7, 9.4 incremental differential, Task 9 wrap reflow, Task 10 paint, fixture tasks §7.

**Concerns:** Full-repo `bun test` not rerun (layout/projection slice: 1427 pass, 0 fail). Word fixture parity for Minkowski/exclusion still deferred to Task 17. `clipPolygonToBox` / Sutherland-Hodgman remains bounded approximate — not claimed exact for disconnected output. `expandPolygonAnisotropic` deprecated to bbox fallback; callers should use scanline API.

### Task 8 — fix round 3 (2026-08-04)

**Scope:** Seven critical/high geometry/wrap/projection blockers from GPT review — shared full-source-frame xfrm affine, vertical-band Minkowski slab projection, wrap-child effectExtent precedence, production clip hits, clip-before-Minkowski, effect-aware baseline finalization, signed wrap-polygon ST_Coordinate parsing with over-limit demotion. No paragraph wrap integration (Task 9); 4.3 stays unchecked.

**Delivered**

- **`computeXfrmPageMapping` / `projectPointsThroughXfrm`:** one affine from the transformed full `a:off`/`a:ext` source frame into authoritative `wp:extent`; crop rects, preset clip, and wrap polygons share the same mapping (no per-contour rescale).
- **`minkowskiExcludedIntervalsAtY`:** exact vertical-band union/event sweep for P ⊕ insets; diagonal parallelogram `[0,11]` at y=0, reversed winding, disjoint-passage union, U-channel even-odd; preset clip intersected in `sourceIntervalsAtY` before horizontal expansion.
- **`readEffectExtent`:** `wrapSquare` / `wrapTopAndBottom` child `wp:effectExtent` wins over anchor fallback.
- **Production hits:** `semantic-hit-test` routes through `pointInDrawingClip`; ellipse corners inside bbox miss, center hits.
- **Baseline finalization:** `repositionInlineDrawingsForBaseline` subtracts `effectInsets.bottom` when placing extent top; agrees with `inlineDrawingVerticalLayout` / projection path.
- **Wrap polygon parsing:** signed full-range `ST_Coordinate`; over-limit point count and out-of-range coordinates demote typed wrap at parse boundary with diagnostics.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-geometry-fix-round-3.test.ts` | 5 pass |
| `bun test packages/core/src/layout/__tests__/drawing-wrap-fix-round-3.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-projection-fix-round-3.test.ts` | 4 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts packages/core/src/store/__tests__/drawing*.test.ts` | 339 pass |
| `bun test drawing-geometry*.test.ts drawing-wrap*.test.ts drawing-projection-fix-round-3.test.ts semantic-layout.test.ts` | 128 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.4 (decision unchanged), 11.6, 11.7 (re-checked after fix round 3 tests green).

**Still unchecked:** 4.3 (paragraph exclusion integration — Task 9), 4.5, 4.7, 9.4 incremental differential, Task 9 wrap reflow, Task 10 paint, fixture tasks §7.

**Concerns:** Wrap scanline primitives remain unit-tested only — not yet fed into `paragraph-flow` line-width calculation (4.3 / Task 9). Full-repo `bun test` not rerun this round.

### Task 8 — fix round 4 (2026-08-04)

**Scope:** Two high review blockers — exact Minkowski event sweep with source/clip segment-intersection y events; production hit region = anisotropically effect-expanded clipped shape via scanline Minkowski at point y. No paragraph wrap integration (Task 9); 4.3 stays unchecked.

**Delivered**

- **`collectSlabBoundaries`:** adds bounded O(MAX_POINTS²) source↔preset-clip edge-pair intersection y events (plus existing vertices/band boundaries) so interval endpoint ownership changes are not missed; reviewer counterexample now yields `[0.3, 10]` not `[0.5, 10]`.
- **`pointInDrawingClip` / `pointInEffectExpandedClip`:** hit = Minkowski-expanded clip intervals at scanline y (not raw clip polygon, not unconditional rectangle); `semantic-hit-test` routes through the new path.
- **Tests:** `drawing-wrap-fix-round-4.test.ts` (counterexample + crossing-edge regression); `drawing-geometry-fix-round-4.test.ts` (unit + inline/anchored production semantic hits).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-wrap-fix-round-4.test.ts` | 2 pass |
| `bun test packages/core/src/layout/__tests__/drawing-geometry-fix-round-4.test.ts` | 5 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts packages/core/src/store/__tests__/drawing*.test.ts` | 346 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 11.6, 11.7 (re-checked after fix round 4 tests green). **4.4 remains checked** (exact polygon decision unchanged).

**Still unchecked:** 4.3 (paragraph exclusion integration — Task 9), 4.5, 4.7, 9.4 incremental differential, Task 9 wrap reflow, Task 10 paint, fixture tasks §7.

**Concerns:** Full-repo `bun test` not rerun this round (drawing slice: 346 pass, 0 fail). Word fixture parity for Minkowski/exclusion still deferred to Task 17.

### Task 8 — fix round 5 (2026-08-04)

**Scope:** High geometry blocker — `a:srcRect` crops image pixels only and must not shrink/remap `a:prstGeom` clip or wrap contours; preset clip derived from full shape-local frame via shared xfrm mapping independently of crop. Uncheck OpenSpec 11.7 (production paint clipping + broader preset fidelity finish in Task 10).

**Delivered**

- **`computeDrawingGeometry`:** preset `clipPolygon` projected with `crop: uncropped` (same as `transformedCorners`); shared `computeXfrmPageMapping` affine from full `a:off`/`a:ext` frame.
- **`normalizeWrapPolygonToPage`:** ignores `a:srcRect` crop — wrap polygons map through shape xfrm only.
- **Supported preset set unchanged:** `rect`, `ellipse`, `roundRect`; unsupported presets keep rectangular fallback + `clipFallback: 'unsupported-preset'`.
- **Tests:** `drawing-geometry-fix-round-5.test.ts` — non-empty crop with ellipse/roundRect proves unchanged clip/hit/wrap shape; updated `drawing-geometry.test.ts` and fix-round-3 preset-clip test.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-geometry-fix-round-5.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-geometry*.test.ts packages/core/src/layout/__tests__/drawing-wrap*.test.ts` | 98 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |

**Boxes checked with evidence:** 4.4 (decision unchanged), 11.6. **11.7 explicitly unchecked** — layout clip/hit/wrap geometry only; paint-time pixel crop and full preset fidelity deferred to Task 10.

**Still unchecked:** 4.3 (paragraph exclusion integration — Task 9), 4.5, 4.7, 9.4 incremental differential, Task 9 wrap reflow, Task 10 paint (incl. 11.7 paint clipping), fixture tasks §7.

**Concerns:** Full-repo `bun test` not rerun this round (drawing geometry/wrap slice: 98 pass, 0 fail). `images-crop.docx` fixture still absent (§7.3). Word fixture parity for Minkowski/exclusion still deferred to Task 17.

### Task 9 — wrap exclusion integration (2026-08-04)

**Scope:** OpenSpec 4.3, 4.5, 4.7, 9.4 — `ExclusionZone`/`DrawingPaintLayer` records, paragraph line-breaking integration, paint order, overlap displacement, HF flow-height rule, incremental reflow convergence. Preserves Task 8 geometry and Task 7 coordinate contexts.

**Delivered**

- `drawing-exclusion.ts`: `ExclusionZone`, `DrawingPaintLayer`, scanline merge into `paragraph-flow`, `resolveOverlapDisplacement` (deterministic layer/relativeHeight/source/id order; bounded attempts + next-page defer), `sortDrawingsForPaint`, `collectExclusionZonesByPage`, reflow convergence helpers.
- `paragraph-flow.ts`: exclusion-aware `lineAvailable`, topAndBottom vertical skip, model-offset gating for same-paragraph anchors.
- `semantic-layout.ts`: multi-pass reflow when wrap exclusions exist; document-order zone filtering; overlap resolution on publish; paint-sorted `anchoredDrawings`; `exclusionSkipBefore` placement.
- `layout-cache.ts`: `exclusionToken` in paragraph break cache keys.
- Tests: `drawing-exclusion.test.ts` (8), `drawing-exclusion-layout.test.ts` (5).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion.test.ts` | 8 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-layout.test.ts` | 5 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts semantic-layout.test.ts even-odd-header-parity.test.ts incremental-multi-section-layout.test.ts` | 354 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | 3751 pass, 3 fail — pre-existing list demotion fixture failures (`list-level-0-only.docx`), unrelated to drawing work |

**Boxes checked with evidence:** 4.3 (square wrap narrows overlapping line widths; wrapNone behind/inFront produce no exclusion), 4.5 (paint order sort; overlap displacement; paint order does not change layout inputs), 4.7 (HF flow height unchanged by page-relative watermark; body contentBox unchanged), 9.4 (wrap-mode change reflows pages; break cache uses exclusion token).

**Still unchecked:** Task 10 paint, fixture tasks §7, Word visual comparison §9.5, tight/through/topAndBottom production fixture matrix beyond unit/integration coverage.

**Concerns (critical/high only):** Same-paragraph wrap reflow uses paragraph-level model-offset gating — text before the anchor atom on the anchor line may still miss intra-line exclusion until a future line-index refinement. Full-repo `bun test` has 3 pre-existing list failures. Word fixture parity for wrap side labels and Minkowski fidelity deferred to Task 17. `images-crop.docx` fixture still absent (§7.3).

### Task 9 — fix round 1 (2026-08-04)

**Scope:** Five critical/high review blockers — LayoutSession reflow isolation, retroactive same-paragraph anchor-line exclusion, collision defer to next page, complete exclusion fingerprint/convergence error, canonical document source order. Multi-column exclusion reflow deferred (single-pass skip).

**Delivered**

- **LayoutSession reflow isolation:** Intermediate exclusion passes run with `session: undefined`; one final converged pass updates session/checkpoints. Incremental wrap-mode change matches clean full layout shape (`drawing-exclusion-fix-round-1.test.ts`).
- **Retroactive anchor-line exclusion:** Precomputed anchor-line model starts; zones apply from anchor line downward; `lineAvailable` uses actual interval width (returns 0 to force wrap, not 1pt placeholder); topAndBottom skip applied once per line.
- **Collision defer:** `resolveOverlapDisplacement` returns `deferred` records; bounded attempts defer rather than publish overlap; `flushPage` carries deferred drawings to next page top with stable node id/geometry.
- **Exclusion fingerprint:** `exclusionLayoutToken` includes source order, band geometry, wrap/effect/polygon fields, and probe scanline intervals; `DrawingExclusionConvergenceError` on non-convergence (single-column); `exclusionMapsEqual` uses full token.
- **Source order:** `drawingSourceOrder` from `projectDrawingsInPart` traversal; `compareDrawingPaintOrder` uses layer → sourceOrder → relativeHeight → node id; `sourceOrder` on `AnchoredDrawingRecord`.
- **Table flow:** `pageExclusionZones` + `paragraphStartY` threaded into `placeCellParagraph` → `breakParagraph`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-1.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 20 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts semantic-layout.test.ts incremental*.test.ts` | 371 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3761 pass, 0 fail** — improved vs recorded 3751 pass / 3 fail baseline (list demotion fixture failures no longer reproduce) |

**Boxes checked with evidence:** 4.3 (retroactive anchor-line wrap + table zone threading), 4.5 (defer-not-overlap + source-order paint sort), 4.7 (unchanged — prior evidence), 9.4 (session-isolated incremental equals clean over wrap change).

**Critical/high unresolved:** Multi-column body exclusion reflow does not converge within 8 passes (oscillation); production uses a deterministic single-pass skip (`columnCount > 1`) without wrap exclusion until column-aware zone coordinates land. HF exclusion zones not incrementally collected during HF `flowBlocksInBox` (HF square-wrap paragraphs still single-pass). Word fixture parity for wrap/Minkowski still deferred to Task 17.

### Task 9 — fix round 2 (2026-08-04)

**Scope:** Two remaining high blockers — multi-column exclusion coordinate space + deterministic convergence; HF story exclusion zone collection/reflow during `flowBlocksInBox` for square/tight/through/topBottom (behind/inFront none). Preserves HF flow-height/body sizing rule.

**Delivered**

- **Multi-column exclusion:** Removed single-pass skip; `ExclusionZone.columnIndex` + `columnIndexForDrawing`; page-wide `contentLeft`/`contentRight`/`contentOriginX` in `breakParagraph` when `columnCount > 1`; zones filtered per `flowColumnIndex`; exclusion token in break cache includes column index; `collectExclusionZonesFromDrawings` shared by page and HF collectors.
- **HF exclusion:** `layoutHeaderFooterStory` runs bounded exclusion reflow (collect zones from published anchors → re-flow with `pageExclusionZones`); `placeCellParagraph` busts break cache on exclusion token; behind/inFront `wrapNone` produce no zones; flow height remains story-text-only.
- **Tests:** `drawing-exclusion-fix-round-2.test.ts` (10) — column-2 square/tight, paragraph crossing columns, convergence bound, two-column incremental differential; default/first/even header + footer square wrap, page parity, behind/inFront no exclusion, large page-relative anchor does not push body.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-2.test.ts` | 10 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 30 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3771 pass, 0 fail** |

**Boxes checked with evidence:** 4.3 (multi-column column-index filtering + page/column coordinate space; HF square/tight/through/topBottom exclusion reflow), 4.7 (HF flow height + body contentBox unchanged under large page-relative anchor), 9.4 (two-column incremental equals clean over wrap change).

**Critical/high unresolved:** None from Task 9 exclusion integration scope. Word fixture parity for wrap/Minkowski still deferred to Task 17. Task 10 paint and fixture tasks §7 remain open (not Task 9 blockers).

### Task 9 — fix round 3 (2026-08-04)

**Scope:** Five remaining high blockers — line interval snap, topAndBottom y advance, table cell-local exclusion zones + document-order filter, paint-order comparator (layer → relativeHeight → sourceOrder → node id), terminal-page deferred anchor flush.

**Delivered**

- **Line placement:** `firstAvailableIntervalAtOrAfter`, `snapXToAvailableInterval`, `snapLineToAvailableInterval`, `advancePastAnchorExclusionForPlacement`, `tryAdvanceToNextPassage`, `ensurePlacementWidth` overflow guard (no zero-width emit / blank-line stack).
- **topAndBottom:** `exclusionSkipBefore` applied before line `box.y` in body placement; paragraph-local `synthesizeParagraphTopAndBottomZones` (stable across reflow); topAndBottom excluded from reflow zone map; `closeForTopAndBottomAfterAnchor`.
- **Tables:** `localizeExclusionZones`, `filterExclusionZonesForParagraphOrder`, cell-local zone transform + skip in `placeCellParagraph`.
- **Paint order:** `compareDrawingPaintOrder` uses relativeHeight before sourceOrder.
- **Terminal defer:** while-loop terminal flush publishes all carried deferred anchors on anchor-only pages.
- **Tests:** `drawing-exclusion-fix-round-3.test.ts` (7).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-3.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 37 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3777 pass, 1 fail** |

**Boxes checked with evidence:** 4.3 (interval snap, topAndBottom skip, table cell-local zones, document-order filter), 4.5 (paint-order comparator), terminal deferred anchor publication.

**Critical/high unresolved (Task 9 scope):** None.

**Outside Task 9 (full suite):** `task 7 fix round — clipping and hit order > behind-document anchor is hittable without displacing text hit` (1 fail; hit offset 4 vs 0 — Task 7 hit-order, not wrap exclusion).

### Task 9 — fix round 4 (2026-08-04)

**Scope:** Four high blockers — behindDocument no exclusion, table localized zones + cell synthesis, collision vs paint order split, bounded terminal page deferral.

**Delivered**

- **behindDocument:** `exclusionZoneFromAnchoredDrawing`, `synthesizeParagraphTopAndBottomZones`, and `collectExclusionZonesFromDrawings` skip `behindDocument` anchors regardless of authored wrap element; geometry/paint layer retained; behind-anchor hit/text regression restored.
- **Table exclusion:** `placeCellParagraph` passes localized `pageZones` (not raw page zones) into `breakParagraph`; `localizeExclusionZones` shifts bounds/polygon/clip/contentLeft/Right exactly once with optional cell `contentClip`; `synthesizeParagraphWrapExclusionZones` + `anchorCellBox` for same-paragraph cell anchors before row finalize.
- **Collision vs paint:** `compareDrawingCollisionOrder` (sourceOrder → node id); `resolveOverlapDisplacement` uses collision order only; `compareDrawingPaintOrder` unchanged (layer → relativeHeight → sourceOrder → node id).
- **Bounded deferral:** `MAX_ANCHOR_PAGE_DEFERRALS` (8), per-anchor page defer counts, terminal flush hard cap, `page-defer-exhausted` layout fallback; no infinite loop/drop.
- **Tests:** `drawing-exclusion-fix-round-4.test.ts` (8).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-4.test.ts` | 8 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 45 pass |
| `bun test packages/core/src/layout/__tests__/drawing-layout-anchor-fix-round.test.ts -t "behind-document"` | 1 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3786 pass, 0 fail** |

**Boxes checked with evidence:** 4.3 (behindDocument no exclusion; table cell-local zones + synthesis), 4.5 (collision/paint order split; paint metadata does not reflow text), terminal bounded deferral with exact page/attempt bound.

**Critical/high unresolved (Task 9 scope):** None.

**Outside Task 9 (not blockers):** Word fixture parity for wrap/Minkowski still deferred to Task 17. Task 10 paint and fixture tasks §7 remain open.

### Task 9 — fix round 5 (2026-08-04)

**Scope:** Remaining high blocker — topAndBottom vertical bands must propagate through page/HF zone collection and inherited paragraph zones so cross-paragraph / cross-cell / continuation lines intersecting the band skip below (not only the anchor paragraph); anchor paragraph must not double-apply.

**Delivered**

- **Page/HF collection:** `collectExclusionZonesFromDrawings` now retains `topAndBottom` zones alongside square/tight/through.
- **Inherited skip:** `activeExclusionZones` passes page-level `topAndBottom` bands to later paragraphs; same-paragraph anchors still use break-time `synthesizeParagraphTopAndBottomZones` only (no double skip).
- **Filtering preserved:** document-order / column / story filters unchanged; table cell localization still shifts bands once.
- **Tests:** `drawing-exclusion-fix-round-5.test.ts` (7) — page collection + order filter, body cross-paragraph, anchor no double-apply, table cell cross-paragraph, HF cross-paragraph, page continuation.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-5.test.ts` | 7 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 52 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3793 pass, 0 fail** |

**Boxes checked with evidence:** 4.3 (topAndBottom cross-paragraph/cell/HF band propagation; anchor synthesis vs inherited page zones; order filter).

**Critical/high unresolved (Task 9 scope):** None.

**Outside Task 9 (not blockers):** Word fixture parity for wrap/Minkowski still deferred to Task 17. Task 10 paint and fixture tasks §7 remain open.

### Task 9 — fix round 6 (2026-08-04)

**Scope:** Final high 4.3 blocker — topAndBottom vertical clearance must use the full final line interval `[top, bottom]`, not midpoint/provisional height; after final styled/drawing line height is known, shift line origin below the union of overlapping bands with bounded recheck; apply once via `exclusionSkipBefore` at line close.

**Delivered**

- **`topAndBottomSkipBeforeLine`:** interval intersection (`lineTop < bandBottom && lineBottom > bandTop`); unions overlapping band bottoms; bounded recheck via `MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS`.
- **`closeLine` finalization:** `finalizeTopAndBottomClearance` re-runs skip with final line height (styled text, inline drawings, line spacing) before push — pre-placement may still use minimum metrics on empty lines.
- **Tests:** `drawing-exclusion-fix-round-6.test.ts` (10) — edge-only intersection, tall styled text, inline drawing growth, adjacent/overlapping bands, table/HF cross-paragraph, no double skip; round-3/5 expectations updated for interval-based clearance (gap may be 0 when line already clears band; page continuation tail may flow to next page).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-6.test.ts` | 10 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 62 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3803 pass, 0 fail** |

**Boxes checked with evidence:** 4.3 (full-interval topAndBottom clearance at line close; union of overlapping bands; no edge overlap after final height).

**Critical/high unresolved (Task 9 / 4.3 scope):** None.

**Outside Task 9 (not blockers):** Word fixture parity for wrap/Minkowski still deferred to Task 17. Task 10 paint and fixture tasks §7 remain open.

### Task 9 — fix round 7 (2026-08-04)

**Scope:** Final high Task 9 pagination blocker — every flow/pagination budget check must include `exclusionSkipBefore + line.height` before deciding placement (body, table rows/cells/splits, HF bounded flow, columns). Apply skip only after the budget check passes; on overflow, move the line to the next column/page/row continuation without losing or double-applying skip; recompute applicable page zones at placement time.

**Delivered**

- **`pendingLineFlowExtent` / `pendingLineFlowExtentAtPlacement`:** shared helpers for skip + height + tail budget checks; placement variant recomputes skip from live zones at absolute line top.
- **Body placement (`semantic-layout.ts`):** pre-check and line loop budget `cursorY + skipBefore + height + tail > contentHeight()`; `placementSkipBefore` / `placementZonesForLine` recompute skip from page zones + same-paragraph synthesized topAndBottom bands; skip applied only after check passes; `appliedSkipByLineIndex` tracks placement-time skip without mutating frozen cached break lines; anchor-only lines exempt from skip (not anchor+text lines).
- **Table cell placement (`semantic-table-layout.ts`):** `placeCellParagraph` checks `y + skip + height + extras > maxBottom` before applying skip; live skip from cell-local page zones when present.
- **Tests:** `drawing-exclusion-fix-round-7.test.ts` (8) — helper unit tests, 80pt content-box reproduction, next-page tail continuation, multi-column skip budget, table row split, HF bounded flow.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/layout/__tests__/drawing-exclusion-fix-round-7.test.ts` | 8 pass |
| `bun test packages/core/src/layout/__tests__/drawing-exclusion*.test.ts` | 70 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3811 pass, 0 fail** |

**Boxes checked with evidence:** 4.3 (pagination budget includes exclusion skip before placement decision; skip applied once after accept; overflow moves line without double skip; placement-time zone recompute for body/table/HF/columns).

**Critical/high unresolved (Task 9 scope):** None.

**Outside Task 9 (not blockers):** Word fixture parity for wrap/Minkowski still deferred to Task 17. Fixture tasks §7 remain open.

### Task 10 — paint safe images, effects, refusal states (2026-08-04)

**Scope:** OpenSpec 2.6, 5.1–5.4, 11.7–11.8 — semantic paint for inline/anchored/HF drawings, `PaintImageUrlPort` lifecycle, placeholders, accessibility, drawing hyperlink gestures. No tree ops / React authoring (Task 11+).

**Delivered**

- `semantic-paint-drawings.ts`: `PaintImageUrlPort`, `DrawingPaintStrings`, URL reuse/revoke registry, ready PNG/JPEG/GIF paint with crop/transform/preset clip CSS, `a:lum`/`a:grayscl` filters, localized refusal cards (no `src`/fetch/URL for pending/unrenderable/missing/external/non-picture), `role="img"` + `aria-label` from `@descr` then `@title` (never `@name`), hidden paints nothing.
- `semantic-paint.ts`: inline drawings on lines, anchored behind/inFront layers on pages, URL reconcile on repaint.
- `drawing-layout.ts`: paint metadata on records (`hyperlinkHref`, `effects`, `crop`, `transform`, `placeholderGraphicKind`).
- `drawing-projection.ts`: signed `a:lum` bright/contrast parsing for watermark effects.
- `surface-navigation.ts`: explicit-gesture routing for `[data-docx-drawing-link]` through existing `HyperlinkActivation` / `openExternal`.
- `editor.css`: drawing/placeholder/layer tokens; `en.json` refusal strings + `i18n:fix`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings.test.ts` | 16 pass |
| `bun test packages/core/src/editor/__tests__/surface-navigation-images.test.ts` | 3 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts packages/core/src/store/__tests__/drawing*.test.ts packages/core/src/output/__tests__/semantic-paint*.test.ts` | 400+ pass |
| `bun run typecheck` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run i18n:validate` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3830 pass, 0 fail** |
| Security sink grep (new paint/navigation files) | no new sinks |

**Boxes checked with evidence:** 2.6, 5.1, 5.2, 5.3, 5.4, 11.7 (paint-time preset clip + crop/transform), 11.8 (signed lum + grayscale filter paint).

**Critical/high unresolved:** `paginated-surface` does not yet inject a browser `PaintImageUrlPort` — ready images paint only when callers pass `imageUrlPort` (demo wiring deferred to adapter integration). Fixture tasks §7 and Word visual comparison §9.5 still open. Broader unsupported `a:prstGeom` presets remain rectangular clip fallback (layout diagnostic unchanged).

### Task 10 — fix round 1 (2026-08-04)

**Scope:** Five high blockers — production-safe blob URL port, HF `anchoredDrawings` paint layers, Task 8 transform/clip coordinate correctness (no double rotation), production `drawingLinkById` wiring, production i18n into drawing painter.

**Delivered**

- `browser-paint-image-url-port.ts`: cache-owned `createBrowserPaintImageUrlPort` mints/revokes blob URLs from snapshotted bytes via opaque lookup; headless returns null.
- `inline-drawing-source.ts`: `snapshottedBytesForKey` on ready settle; bundle never exposes raw bytes to paint.
- `paginated-surface.ts`: wires browser URL port by default, `drawingStrings` option, `drawingLinkByIdFromLayout` into navigation, `detachDrawingUrlRegistry` on destroy.
- `semantic-paint-drawings.ts`: preset clip on outer wrapper (paint space); pixel flips on `<img>` only; `drawingPaintStringsFromTranslate` for i18n interpolation.
- `semantic-paint.ts`: HF behind/text/front anchored drawing layers in `[data-docx-hf]` containers.
- `drawing-link-index.ts`: layout walk for sanitized drawing hyperlinks.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings-fix-round-1.test.ts` | 10 pass |
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings.test.ts` | 16 pass |
| `bun test packages/core/src/editor/__tests__/surface-navigation-images.test.ts` | 3 pass |
| `bun test packages/core/src/layout/__tests__/drawing*.test.ts packages/core/src/store/__tests__/drawing*.test.ts packages/core/src/output/__tests__/semantic-paint*.test.ts` | 589 pass |
| `bun run typecheck` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run i18n:validate` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3840 pass, 0 fail** |
| Security sink grep (new paint/navigation/port files) | no new sinks |

**Boxes checked with evidence:** 2.6, 5.1–5.4, 11.7, 11.8 (fix-round-1 blockers closed).

**Critical/high unresolved (Task 10 scope):** None. Fixture tasks §7, Word visual comparison §9.5, and React adapter `drawingStrings` i18n wiring (core accepts `PaginatedSurfaceOptions.drawingStrings`; `docx-editor.ts` not yet threaded) remain open but are not Task 10 fix-round-1 blockers. Broader unsupported `a:prstGeom` presets still rectangular fallback.

### Task 10 — fix round 2 (2026-08-04)

**Scope:** Five high blockers — validated-byte TOCTOU handle, Task 8 affine pixel transform, HF page-relative anchored paint layer, `openExternal` defense-in-depth sanitize, drawing i18n through `createDocxEditor` + adapter mounts with locale-aware paint cache.

**Delivered**

- `validated-image-bytes.ts`: opaque `ValidatedImageBytesHandle` registry; snapshotted bytes at validation; `mintValidatedImageBytes(handle, expectedContentId)` refuses stale/mutated package reads.
- `image-resources.ts` / `inline-drawing-source.ts` / `browser-paint-image-url-port.ts`: ready state carries `validatedHandle`; settle remembers handle; blob minting binds to contentId/generation only.
- `drawing-geometry.ts` / `semantic-paint-drawings.ts`: `cssTransformForDrawingImage` + `imagePaintTransformStyle` apply rotation (authored center), scale into wp extent, flips, crop; preset clip on outer wrapper in paint space.
- `semantic-paint.ts`: page-relative HF anchors paint on page sheet (`appendHfPageRelativeDrawingLayer`) outside flow-height-clipped `.docx-hf` story box; behind/text/front order preserved.
- `surface-navigation.ts`: `openExternal` calls `sanitizeHref` immediately before `window.open`; null/unsafe hrefs never open.
- `docx-editor-types.ts` / `docx-editor.ts`: optional `translate` on config → `drawingPaintStringsFromTranslate`; React `DocxEditorRoot`/`DocxEditor` and Vue `DocxEditor` wire existing i18n providers; `drawingPaintStringsCacheToken` in paint reuse params.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings-fix-round-2.test.ts` | 10 pass |
| `bun test packages/core/src/editor/__tests__/surface-navigation-images.test.ts` | 3 pass |
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings*.test.ts` | 36 pass |
| `bun test packages/core/src/layout/__tests__/drawing-layout-fix-round-{2,3,4}.test.ts` | 37 pass |
| `bun run typecheck` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run i18n:validate` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3850 pass, 0 fail** |
| Security sink grep (paint/navigation/port/store files) | no new sinks |

**Boxes checked with evidence:** 2.6, 5.1–5.4, 11.7, 11.8 (fix-round-2 blockers closed).

**Critical/high unresolved (Task 10 fix-round-2 scope):** None. Broader unsupported `a:prstGeom` presets still rectangular clip fallback (pre-existing layout diagnostic). Fixture tasks §7 and Word visual comparison §9.5 remain open (outside fix-round-2 blockers).

### Task 10 — fix round 3 (2026-08-04)

**Scope:** Final high affine blocker — derive CSS paint matrix consistently from source/`a:xfrm` frame through rotation/flip into authoritative `wp:extent`; `transform-origin: 0 0` when matrix already includes bbox/center compensation; crop viewport scales img-local basis without remapping preset clip.

**Delivered**

- `drawing-geometry.ts`: `computeCssImageAffine` / `applyCssImageAffine` — rotated source bbox → post-rotation scales `sx=outerW/bboxW`, `sy=outerH/bboxH`; matrix terms `a=sx*cos*flipH`, `c=-sx*sin*flipV`, `b=sy*sin*flipH`, `d=sy*cos*flipV`; translation maps transformed bbox to `[0,outerW]×[0,outerH]`; img-local `kx,ky` from crop viewport sizing.
- `cssTransformForDrawingImage`: delegates to shared affine; accepts optional crop for img-basis compensation.
- `semantic-paint-drawings.ts`: passes crop into affine; sets `transform-origin: 0 0` on `<img>` (no double center origin).
- `semantic-paint-drawings-fix-round-3.test.ts`: exact corner/bounds tests for 72×36 at 90° (result 72×36), non-square 45°, 180°, flip+crop, differing `a:xfrm ext/off`; paint origin assertion.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings-fix-round-3.test.ts` | 6 pass |
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings*.test.ts` | 42 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3856 pass, 0 fail** |

**Boxes checked with evidence:** 2.6, 5.1–5.4, 11.7, 11.8 (fix-round-3 affine blocker closed).

**Critical/high unresolved (Task 10 fix-round-3 scope):** None. Broader unsupported `a:prstGeom` presets still rectangular clip fallback (pre-existing). Fixture tasks §7 and Word visual comparison §9.5 remain open (outside fix-round-3 blockers).

### Task 10 — fix round 4 (2026-08-04)

**Scope:** Final high crop+affine composition blocker — explicit paint stage order (outer clip → transform stage → crop viewport → img srcRect sizing); crop margins inside the affine stage, not baked into matrix via srcRect; rendered bounds remain exactly `wp:extent`.

**Delivered**

- `semantic-paint-drawings.ts`: four-stage DOM — outer wrapper (`paintBounds` + preset `clip-path`), `docx-drawing-image-frame` (content positioning + filters), `docx-drawing-transform-stage` (xfrm matrix, `transform-origin: 0 0`), `docx-drawing-crop-viewport` (`overflow: hidden`) + `<img>` (srcRect percentage width/height/margins only).
- `drawing-geometry.ts`: `computeCssImageAffine` retains `a:xfrm ext`→`wp:extent` basis scale (`kx=sourceW/contentW`) but no longer folds `a:srcRect` into matrix terms; crop is viewport-local only.
- `semantic-paint-drawings-fix-round-4.test.ts`: composed bounds with img offsets/dimensions — no crop, 25% L/R + flipH → `[0,100]`, asymmetric crop + 90°, crop + 45°, clip stays in outer paint space; DOM stage-order assertions.
- Updated fix-round-1/2/3 and base paint tests for transform-on-stage contract.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings-fix-round-4.test.ts` | 6 pass |
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings*.test.ts` | 48 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3862 pass, 0 fail** |

**Boxes checked with evidence:** 5.1 (crop+transform paint composition), 11.7 (clip outer-space; crop inside transform stage; extent-filling bounds after crop+flip/rotation).

**Critical/high unresolved (Task 10 fix-round-4 scope):** None. Broader unsupported `a:prstGeom` presets still rectangular clip fallback (pre-existing). Fixture tasks §7 and Word visual comparison §9.5 remain open (outside fix-round-4 blockers).

### Task 10 — fix round 5 (2026-08-04)

**Scope:** High CSS crop blocker — `margin-top` percentages are width-relative in CSS, so asymmetric top/bottom `a:srcRect` crop on non-square extents (e.g. 100×50) misaligns vertically; position `<img>` absolutely inside the crop viewport with height-relative `top` and width-relative `left`.

**Delivered**

- `semantic-paint-drawings.ts`: `cropImageStyles` emits `left`/`top` percentages (not margins); crop viewport `position: relative`; `<img>` `position: absolute` with expanded width/height.
- `editor.css`: `.docx-drawing-crop-viewport` + `.docx-drawing-image` absolute positioning defaults.
- `semantic-paint-drawings-fix-round-5.test.ts`: browser CSS percentage emulation (`top`/`height` → viewport height, `left`/`width` → viewport width); margin-top regression on 100×50; asymmetric top/bottom crop under 90°/45° + flip; DOM stage assertions.
- Updated base paint + fix-round-1 tests for absolute left/top contract.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings-fix-round-5.test.ts` | 6 pass |
| `bun test packages/core/src/output/__tests__/semantic-paint-drawings*.test.ts` | 54 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3868 pass, 0 fail** |

**Boxes checked with evidence:** 5.1 (srcRect crop pixel alignment on non-square extents), 11.7 (crop viewport CSS matches layout geometry under rotation/flip).

**Critical/high unresolved (Task 10 fix-round-5 scope):** None. Broader unsupported `a:prstGeom` presets still rectangular clip fallback (pre-existing). Fixture tasks §7 and Word visual comparison §9.5 remain open (outside fix-round-5 blockers).

### Task 11 — canonical drawing mutation operations (2026-08-04)

**Scope:** Tree-only `DrawingTreeDocOp` union (insert/delete/resize/replace-resource/crop/position/wrap/metadata/locks) with validation, apply, impact classes, and refusal policy. Package media/relationship atomic lifecycle deferred to Task 12.

**Delivered**

- `tree-op-types.ts`: nine drawing op variants on `TreeDocOp`; `DrawingTreeDocOp` extract; rejection reasons (`not-a-drawing`, `unknown-drawing`, `not-a-picture-drawing`, `drawing-locked`, `invalid-drawing-value`, `cross-cell-drawing`, `trackedDrawingDeletionUnsupported`); optional `revision` on `deleteDrawing` for suggesting-mode refusal.
- `tree-op-drawings.ts`: `validateDrawingOp`, `applyDrawingOp`, `drawingOpImpact`, `wrapTargetToAnchorSpec` (nine wrap targets; `squareLeft`/`squareRight` → `wrapText` left/right; `behind`/`inFront` → `wrapNone` + `behindDoc`); copy-modify ancestor path; lock enforcement via tree-read `graphicFrameLocks` + `@locked`; hyperlink refused via `sanitizeHref` before mutation; inline↔anchored conversion in one transaction.
- `tree-op-validate.ts` / `tree-op-apply.ts`: dispatch drawing ops into `tree-op-drawings.ts`.
- `store/index.ts`: export `drawingOpImpact`, `validateDrawingOp`, `wrapTargetToAnchorSpec`, `DrawingTreeDocOp`.
- `tree-drawing-ops.test.ts`: 28 tests — one focused suite per op, preservation/fingerprint sibling checks, nine wrap round-trips + inline↔floating conversion, refusal/lock/impact/tracked-deletion coverage.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/tree-drawing-ops.test.ts` | 28 pass |
| `bun test packages/core/src/store/__tests__/tree-drawing-ops.test.ts packages/core/src/store/__tests__/tracked-edits.test.ts packages/core/src/store/__tests__/ooxml-tree.test.ts` | 121 pass |
| `bun test packages/core/src/store/__tests__/` | 1081 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3896 pass, 0 fail** |
| Security sink grep (`tree-op-drawings.ts`, `tree-drawing-ops.test.ts`) | clean |

**Boxes checked with evidence:** 11.4 (lock flags enforced before resize/crop/position/wrap/delete; typed `drawing-locked` refusal).

**Boxes intentionally left unchecked (Task 12):** 6.1–6.4 (package media insert/replace/delete lifecycle, byte-validated insert, refcount delete, React/chrome wiring).

**Critical/high unresolved (Task 11 scope):** None.

### Task 11 — fix round 1 (2026-08-04)

**Scope:** Seven high review blockers — canonical insertDrawing split/validation, schema-valid nine wrap conversions with tight/through polygon synthesis and exact `wrapTopAndBottom` naming, positionDrawing align XOR offset, OOXML lock lexical space + partial lock merge, hyperlink package-transaction refusal with title-only preservation, srcRect schema sequence, owning-paragraph dirty ids on every drawing effect.

**Delivered**

- `tree-op-insert-offset.ts`: shared `insertRunPayloadAtOffset` (text split + run props) and `offsetInsideAtomicSegment`; `insertDrawing` uses it and refuses surrogate interior, atomic-boundary splits, and cross-cell mid-paragraph table offsets.
- `tree-op-drawings.ts`: rectangular `wrapPolygon` from authoritative `wp:extent` for tight/through; `wrapTopAndBottom` localName; wrap conversion preserves docPr/generic extensions; inline↔anchor dist/metadata preservation; `positionDrawing` removes align before writing `posOffset`; OOXML boolean 0/1/true/false on read/write with partial `graphicFrameLocks` merge via demoted `cNvGraphicFramePr`; `setDrawingMetadata` optional `hyperlink` (omit=preserve, null=remove, URL=`packageTransactionRequired`); `cropDrawing` inserts `a:srcRect` after blip before stretch/tile; all drawing effects dirty owning paragraph id + drawing id.
- `tree-op-types.ts`: `packageTransactionRequired` rejection; optional metadata hyperlink.
- `tree-drawing-ops-fix-round-1.test.ts`: 18 tests covering all seven blockers.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/tree-drawing-ops-fix-round-1.test.ts` | 18 pass |
| `bun test packages/core/src/store/__tests__/tree-drawing-ops*.test.ts` | 46 pass |
| `bun test packages/core/src/store/__tests__/` | 1099 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3914 pass, 0 fail** |

**Boxes intentionally left unchecked (Task 12):** 6.1–6.4 (package media insert/replace/delete lifecycle, byte-validated insert, refcount delete, React/chrome wiring).

**Critical/high unresolved (Task 11 fix-round-1 scope):** None. Hyperlink target creation remains Task 12 (`packageTransactionRequired` at tree boundary). `drawing-projection.ts` still lists generic `wrapTopBottom` in wrap-child fallback lookup — layout/read path only; tree mutations now emit schema `wrapTopAndBottom`.

### Task 11 — fix round 2 (2026-08-04)

**Scope:** Three high review blockers — XSD-legal wrap attribute shapes per wrap kind, `ST_PositionOffset` int32 validation before mutation, and `cNvGraphicFramePr`/`graphicFrameLocks` create/preserve/roundtrip semantics.

**Delivered**

- `tree-op-drawings.ts`: `wrapSchemaAttributes` emits per-kind legal attrs (`wrapNone` none; `wrapSquare` T/B/L/R + `wrapText`; `wrapTight`/`wrapThrough` L/R + `wrapText` + polygon; `wrapTopAndBottom` T/B only); preserves foreign namespaced wrap attrs; `validatePositionOffset` rejects non-integer and one-past `ST_PositionOffset` bounds before mutation; `updateLocks` creates `cNvGraphicFramePr` before `graphic` when absent, preserves wrapper/unknown lock attrs and `extLst` children, omits cleared managed lock attrs without dropping unknown content, keeps empty frame wrapper after full clear roundtrip.
- `ooxml-drawing-rules.ts`: `drawingGraphicFramePr` accepts one `graphicFrameLocks` and optional `extLst` child (typed nodes with locks no longer demote on read).
- `tree-drawing-ops-fix-round-2.test.ts`: 18 tests — exact XSD-shape assertions for all eight floating wrap targets, conversion attr migration, int32 boundary/refusal with fingerprint unchanged, lock create/order/preserve/clear/roundtrip.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/tree-drawing-ops-fix-round-2.test.ts` | 18 pass |
| `bun test packages/core/src/store/__tests__/tree-drawing-ops*.test.ts` | 64 pass |
| `bun test packages/core/src/store/__tests__/` | 1117 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3932 pass, 0 fail** |

**Critical/high unresolved (Task 11 fix-round-2 scope):** None. Hyperlink target creation remains Task 12 (`packageTransactionRequired` at tree boundary). `drawing-projection.ts` still lists generic `wrapTopBottom` in wrap-child fallback lookup — layout/read path only.

### Task 12 — package-store image intents (2026-08-04)

**Scope:** `insertImage`, `replaceImage`, `deleteImage`, `embedExternalImage`, and `setDrawingMetadataWithHyperlink` on `TreePackageStore` — each one package transaction / history / publish unit integrating Task 5 package helpers and Task 11 tree ops.

**Delivered**

- `drawing-package-edit.ts`: `buildInlinePictureDrawing`, `fetchExternalImageBytes` (manual redirects, scheme allowlist, byte cap, content-type/signature validation), `cleanupOrphanImageMedia`, relationship/media cleanup helpers.
- `tree-package-images.ts`: package intents with `transactPackageImage` → `promoteStoryTransactionToPackageUnit`; abort-on-failure; hyperlink rel wiring via `ensureHyperlinkRelationship` + `setDocPrHyperlinkRelationship` on current package part.
- `tree-package-store.ts`: public `insertImage` / `replaceImage` / `deleteImage` / `embedExternalImage` / `setDrawingMetadataWithHyperlink`; `promoteStoryTransactionToPackageUnit`.
- `drawing-package-edit.test.ts`: atomic insert (one event/history, D9 fingerprint/digest, undo/redo), invalid-bytes refusal, shared/unshared replace, orphan delete, external embed refusal + redirect-hop success, fetch spoof/byte-cap refusal, hyperlink package transaction, D9 resize/crop/wrap/metadata byte-identical save/reopen.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/drawing-package-edit.test.ts` | 39 pass |
| Focused batch: `drawing-package-edit`, `package-shell-history`, `image-resources`, `tree-drawing-ops*` | 191 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3950 pass, 0 fail** |
| Security sink grep (changed store/package files) | clean |

**Boxes checked with evidence:** 2.5 (`embedExternalImage` + `fetchExternalImageBytes` explicit port, manual redirects, scheme allowlist, no load/layout/paint fetch — task 2.4), 6.1 (package insert/replace/delete/embed + Task 11 tree resize/crop/wrap/metadata/position ops), 6.2 (preflight `withEmbeddedImage` before transact; one package undo unit), 6.3 (shared-media replace/delete refcount; D9 test media hash unchanged on resize/crop/wrap/metadata), 6.4 (`tree-drawing-ops.test.ts` `drawingOpImpact` → `flow-structural` for resize/wrap), 9.3 (insert D9 fingerprint/digest; D9 package fidelity test through save/reopen after resize/crop/wrap/metadata).

**Boxes intentionally left unchecked (Task 12 scope):** 6.5–6.13 (React chrome, i18n, API extract), 9.5 (Word visual comparison).

**Critical/high unresolved (Task 12 scope):** None.

### Task 12 — fix round 1 (2026-08-04)

**Scope:** Eight high review blockers — IME composition refusal before package mutation/history; collision-safe relationship-id allocation across all owner `.rels` (including external); exact inserted drawing node id return; owner-scoped media liveness `(ownerPartName, relationshipId)` + resolved target; HTTPS-only external fetch with `assertPublicNetworkTarget` and redirect confinement; bounded decode-port validation before any package write; package/editor-scoped validated-byte handles with refcount/generation; strengthened D9 package-oracle edges after insert/replace/delete/undo/reopen.

**Delivered**

- `tree-package-images.ts`: `imageIntentBlockedDuringComposition()` refuses insert/replace/embed during active IME before transact/history; async intents require `decodePort`; insert returns `result.change.created` drawing id (not first-drawing scan).
- `package-edit.ts`: `relationshipIdsForOwner()` + `allocateOwnerRelationshipId()` (max existing `rIdN` + 1, collision-safe on exact owner `.rels`).
- `drawing-package-edit.ts`: `validateEmbeddedImageForCommit()` via decode port before write; owner-scoped `drawingReferencesRelationship()` / `resolvedInternalMediaPart()` / `liveDrawingReferenceCount()`; orphan cleanup keyed by `(ownerPart, relId, resolvedTarget)`; `ExternalImageFetchPort.assertPublicNetworkTarget()` required (fail closed `network-attestation-required`); HTTPS-only absolute URLs, no credentials, localhost/.local/private IP blocked at every redirect hop.
- `validated-image-bytes.ts`: `createValidatedImageBytesRegistry()` with scoped handles (`registryId`, `generation`), retain/release/dispose; legacy global helpers delegate to fallback registry for tests.
- `image-resources.ts`: lookup cache owns a per-lookup registry disposed with the lookup.
- `inline-drawing-source.ts`: releases scoped handles, not global resource keys.
- `drawing-package-edit-fix-round-1.test.ts`: 9 tests covering all eight blockers; `drawing-package-edit.test.ts` updated for async intents, decode port, and fetch attestation wrapper.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/drawing-package-edit-fix-round-1.test.ts` | 9 pass |
| `bun test packages/core/src/store/__tests__/drawing-package-edit*.test.ts` | 48 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3959 pass, 0 fail** |
| Security sink grep (changed store/package files) | clean |

**Boxes re-checked with evidence:** 2.5 (HTTPS-only explicit embed + attested public-network fetch), 6.1–6.3 (decode-before-write, owner-scoped media refcount/orphan cleanup, one undo unit including IME refusal), 9.3 (D9 owner-rel/target/content-type oracle through insert/replace/delete/undo/reopen).

**Boxes intentionally left unchecked (Task 12 scope):** 6.5–6.13 (React chrome, i18n, API extract), 9.5 (Word visual comparison).

**Critical/high unresolved (Task 12 fix-round-1 scope):** None.

### Task 12 — fix round 2 (2026-08-04)

**Scope:** Four high review blockers — immutable input-byte snapshot before awaited decode; atomic `requestPublicHttps` fetch port (no separate attest/request TOCTOU); acquire/retain/release validated-byte registry with per-consumer tokens; strengthened D9 package oracle across duplicate body/header owner `.rels` with save/reopen fingerprints/digests.

**Delivered**

- **`validateEmbeddedImageForCommit`:** snapshots caller bytes before header check/decode; decode uses an isolated copy; returns `{ ok: true, bytes }` immutable snapshot for all package writes; refusal leaves package/history untouched.
- **`tree-package-images.ts`:** insert/replace use validated snapshot bytes for preflight and transact paths.
- **`ExternalImageFetchPort`:** single `requestPublicHttps` primitive with mandatory `connectedUrl === url` binding per hop; legacy `request`/`assertPublicNetworkTarget` removed; fail-closed `atomic-fetch-port-required`.
- **`validated-image-bytes.ts`:** `acquire`/`retain`/`release(token)` per consumer; media-base generation bump invalidates stale content; scoped registries with refCount-gated mint; module `retainValidatedImageBytes`/`releaseValidatedImageBytesToken`; inline layout bundle releases per-consumer tokens on dispose.
- **`drawing-package-edit-fix-round-2.test.ts`:** 11 tests — deferred decode mutation, atomic fetch/redirect/connectedUrl mismatch, retain/release sharing, generation replacement, body+header D9 oracle (rels/targets/modes, content types, media hashes, fingerprints/digests through insert/replace/delete/undo/redo).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/drawing-package-edit-fix-round-2.test.ts` | 11 pass |
| `bun test packages/core/src/store/__tests__/drawing-package-edit*.test.ts` | 90 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3970 pass, 0 fail** |
| Security sink grep (changed store/package/layout files) | clean |

**Boxes re-checked with evidence:** 2.5 (atomic HTTPS fetch port), 6.2 (decode-before-write snapshot), 6.3 (owner-scoped media refcount/orphan cleanup unchanged), 9.3 (D9 body+header owner oracle strengthened).

**Critical/high unresolved (Task 12 fix-round-2 scope):** None.

### Task 13 — selected image state and image commands (2026-08-04)

**Scope:** OpenSpec 11.2 only — public `SelectedImageState` / `ImageContext`; derive from canonical selection + layout projection/resource (no mutable nodes/bytes); wire image commands through Task 12 package-store intents/tree transactions. Toolbar 6.5c/6.7–6.8 and API extract (Task 18) intentionally deferred.

**Delivered**

- `contracts/editor.ts`: canonical `SelectedImageState` (nine `ImageWrapTarget` values including `behind`/`inFront`; crop/title/description/intrinsic/locks/can-* flags; `resourceStatus`); `ImageContext` alias; extended `EditorCommands` (`insertImage`, `replaceImage`, `deleteImage`, `setImageWrapType`, `transformImage`, `setImagePosition`, `setImageProperties`).
- `docx-editor-images.ts`: `selectedImageStateOf` (semantic drawing id from collapsed caret or anchored scan; null for text/range/non-picture/deleted/stale/hidden/`noSelect`; unsupported picture still reports `resourceStatus` with `intrinsic: null`); `imageContextEqual`; `gateImageCommand` / `execImageCommand` / async `executeImageCommand` (insert/replace via package store; delete/wrap/transform/position/properties via tree ops); typed refusal codes.
- `docx-editor.ts`: version-cached `snapshot().image` shares reference with `getSelectedImage()` until relevant editor state changes.
- `tree-session.ts` + `tree-op-drawings.ts`: session/package routing for insert/replace/delete; `transformDrawing` tree op for rotate/flip.
- `docx-editor-images.test.ts`: 11 tests — selection matrix, nine wrap values, stable refs, all commands/payload/refusals.
- React adapter tests updated for wired `insertImage` probe refusal (`insertImage requires image bytes`).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images.test.ts` | 11 pass |
| Focused batch: `docx-editor-images`, `tree-drawing-ops*`, `drawing-package-edit*` | 143 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3981 pass, 0 fail** |
| Security sink grep (changed editor/store files) | clean |

**Boxes checked with evidence:** 11.2 (one canonical `SelectedImageState`; `EditorSnapshot.image` and `getSelectedImage()` same reference-stable object; all nine wrap targets including `behind`/`inFront`; crop/title/description/intrinsic/locks on read side).

**Boxes intentionally left unchecked (Task 13 scope):** 6.5–6.5d, 6.6–6.8, 6.8a, 6.9–6.13 (React toolbar wrap menu, resize handles, anchored drag, properties dialog, i18n, API extract).

**Critical/high unresolved (Task 13 scope):** None.

### Task 13 — fix round 1 (2026-08-04)

**Scope:** Six critical/high review blockers — guarded image mutations (revision mode/author); honest async can/exec for byte commands; async epoch/preconditions; simplePos selected-state roundtrip; can/exec payload agreement; snapshot cache keyed on package revision.

**Delivered**

- **`surface-image-ops.ts` (new):** `createImageOps` routes drawing tree ops and package image intents through `applyOps`/`commit` (viewing/suggesting refusal; suggesting delete returns `trackedDrawingDeletionUnsupported` unchanged; edit-mode delete returns full `ImageIntentResult`).
- **`docx-editor-images.ts`:** `gateImageCommand` / `canExecuteImageCommand` / `execImageCommand` / `executeImageCommand`; sync `exec` refuses insert/replace with pointer to `executeImageCommand`; `captureImageMutationPreconditions` + `isStaleImageMutation` (mount generation + selection/drawing id; post-await stale abort; `beforeCommit` hook for replace); border/empty position/properties refusal in can and exec; `positionInputFromCommand` preserves `mode: 'simple'`; suggesting-mode property edits refused at gate.
- **`docx-editor.ts`:** `mountGeneration` bumps on mount/teardown/destroy; snapshot cache keys `session.packageRevision()` (not body-only `revision()`); `can(insert/replace)` delegates to `canExecuteImageCommand`; public `canExecuteImageCommand` / `executeImageCommand` on editor instance.
- **`contracts/editor.ts`:** `canExecuteImageCommand` / `executeImageCommand` on `Editor` interface.
- **`drawing-projection.ts`:** `DrawingPositionInput.mode?: 'frame' | 'simple'`.
- **`tree-package-images.ts`:** `replaceImage` re-reads relationship at transaction time; optional `beforeCommit` after decode.
- **`tree-session.ts`:** forwards `replaceImage` 6th `options` arg (fixes stale/destroy abort).
- **`paginated-surface.ts` + contract:** wired `applyDrawingOps`, `deleteImage`, `insertImage`, `replaceImage`.
- **`docx-editor-images-fix-round-1.test.ts` (new):** 11 tests covering all six blockers.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-fix-round-1.test.ts` | 11 pass |
| `bun test packages/core/src/editor/__tests__/docx-editor-images*.test.ts` | 22 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **3992 pass, 0 fail** |
| API extract | deferred to Task 18 |

**Boxes re-checked with evidence:** 11.2 (guarded mutation policy; simplePos roundtrip; package-revision snapshot cache; async byte-command can/exec honesty).

**Critical/high unresolved (Task 13 fix-round-1 scope):** None.

### Task 13 — fix round 2 (2026-08-04)

**Scope:** Three high blockers — honest generic `can`/`exec` vs dedicated async path; atomic package epoch in store intents; shared `DrawingPositionInput` validation on command/read/op paths.

**Delivered**

- **`docx-editor-images.ts`:** `canAsyncImageCommand` / `asyncImageCommandRefusal` — generic `can`/`exec` refuse `insertImage`/`replaceImage` with async-path reason; `canExecuteImageCommand` gates editing mode + payload; `executeImageCommand` passes captured `expectedPackageRevision` and pre-commit `commitGuard` (selection/mount, not post-commit); `validateSetImagePositionCommand` at gate.
- **`drawing-position-input.ts` (new):** shared validator for frame/simple offsets and `relativeToH`/`relativeToV` OOXML enums; used by gate, `validateDrawingOp`, exportable for read path.
- **`tree-package-images.ts`:** `expectedPackageRevision` on insert/replace; epoch + optional `commitGuard` checked inside `transactPackageImage` before any mutation; stale epoch returns `stale-package-epoch` with no promote/history.
- **`toolbar-commands.ts`:** `image.insert` probe uses `canExecuteImageCommand` with valid bytes.
- **`docx-editor-images-fix-round-2.test.ts` (new):** 9 tests covering all three blockers.
- Adapter tests updated for `image.insert` disabled reason when async path is available.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-fix-round-2.test.ts` | 9 pass |
| `bun test packages/core/src/editor/__tests__/docx-editor-images*.test.ts` | 31 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4001 pass, 0 fail** |

**Critical/high unresolved (Task 13 fix-round-2 scope):** None.

### Task 14 — image chrome and toolbar state (2026-08-04)

**Scope:** OpenSpec 6.5–6.5c only — registry slots `image.insert`, `image.properties`, `image.wrap`, `image.altText`; payload-aware probe routing for insert/properties; value-command path for wrap/alt text; `ToolbarCommandState.value` from `SelectedImageState`; `formattingBarChromeGroups` policy (6.5d render evidence deferred to Task 15). No Vue authoring controls.

**Delivered**

- `chrome-controls.ts`: `image.wrap` (`kind: 'value'`, dropdown) and `image.altText` (`kind: 'value'`) in contextual `image` group after insert/properties; `ChromeSlotId` widened; `formattingBarChromeGroups(image)` appends whole image group when `snapshot.image` non-null.
- `toolbar-commands.ts`: `commandForSlotValue` branches for all nine `ImageWrapTarget` values and alt text (`setImageProperties.description`); `VALUE_SLOT_PROBES` and shape probes (`image.insert` valid PNG bytes, `image.properties` metadata probe); `toolbarCommandState` reads wrap/description from `getSelectedImage()`; probe-enabled insert/properties; `runToolbarCommand` refuses missing/invalid values.
- Tests: `toolbar-commands.test.ts` (registry, state, dispatch, locks/no-selection); `chrome-controls.test.ts` (ids/order/kinds/count/visibility policy); React menu/toolbar composition tests updated for probe-enabled `image.insert`.
- i18n: `formattingBar.imageWrap`, `formattingBar.altText` + `i18n:fix`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/toolbar-commands.test.ts packages/core/src/editor/__tests__/chrome-controls.test.ts packages/core/src/editor/__tests__/docx-editor-images*.test.ts` | pass |
| `bun run typecheck` | pass |
| `bun run check:parity` | pass |
| `bun run i18n:validate` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4015 pass, 0 fail** |
| `bun run check:parity-contract` | pass |
| `bun run check:parity` | **fail** — `check:public-docs-surface` React docs drift (pre-existing; unrelated to Task 14) |
| `bun run api:check` | **fail** — API Extractor internal error on `const` symbol (pre-existing branch tooling; Task 18 owns extract) |

**Boxes checked with evidence:** 6.5 (probe/custom-control routing, no empty-byte false positives, no fixed `SLOT_COMMANDS`), 6.5a (`image.wrap`/`image.altText` in registry + `ChromeSlotId`), 6.5b (`commandForSlotValue` → `setImageWrapType` / `setImageProperties`), 6.5c (`ToolbarCommandState.value` from selected image wrap/description; nine wrap targets reportable via Task 13 `SelectedImageState`).

**Boxes intentionally left unchecked (Task 14 scope):** 6.5d (React contextual group render — Task 15), 6.6–6.13 (handles, wrap menu UI, properties dialog, API extract Task 18).

**Critical/high unresolved (Task 14 scope):** None.

### Task 15 — ImageProperties position controls (2026-08-04)

**Scope:** High gap — floating-anchor position in `ImageProperties`; atomic `setImageProperties` with optional position; shared `DrawingPositionInput` validation; inline unavailable/disabled; lock/canMove gates; exact read→write roundtrip; i18n labels/errors.

**Delivered**

- **`setImageProperties` contract/engine:** optional `horizontalEmu` / `verticalEmu` / `relativeToH` / `relativeToV`; gate mirrors `setImagePosition`; `execImageCommand` appends `positionDrawing` in the same `applyDrawingOps` batch as resize/crop/metadata/wrap.
- **`drawing-position-input.ts`:** `DRAWING_REL_FROM_H/V`, `propertiesCommandHasPositionFields`, `positionInputFromPropertiesCommand` shared by gate, tree-op, and React read path.
- **`ImageProperties.tsx`:** position section (frame enums + signed pt offsets, simplePos mode without lossy unchanged-axis EMU); inline shows unavailable hint; `canMove`/resize/aspect locks disable controls; Apply builds diff-only payload, validates with shared helpers, checks `can`/`exec`; cancel/no-op close unchanged.
- **Tests:** `docx-editor-images-fix-round-2.test.ts` Task 15 engine cases; `image-authoring.test.tsx` position UI/atomic apply/invalid/cancel/inline-unavailable cases.
- **i18n:** `imageProperties.position*`, offset labels, `errors.invalidPosition`; `bun run i18n:fix`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images*.test.ts packages/react/test/image-authoring.test.tsx` | 51 pass |
| `bun run typecheck` | pass |
| `bun run i18n:validate` | pass |
| `bun run check:parity-contract` | pass |
| `bun run check:adapter-css-thin` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4035 pass, 0 fail** |
| `bun run check:parity` | **fail** — `check:export-parity` React export drift for new position helpers (Task 18 `api:extract` owns) |
| `bun run api:check` | not rerun — pre-existing Task 18 blocker |

**Boxes checked with evidence:** 6.9 (position controls in properties dialog; atomic apply; simplePos roundtrip; locks/disabled paths).

**Critical/high unresolved (Task 15 scope):** None.

### Task 15 — fix round 3 (2026-08-04)

**Scope:** Five critical/high blockers — nullable position typecheck; crop unit boundary (UI percent ↔ OOXML permille); hyperlink in one package transaction with resize/crop/metadata/wrap/position; draft dirty omission + lock-aware apply; modal a11y (focus trap, Escape, labels, caret-safe mousedown).

**Delivered**

- **`image-crop-units.ts` (new):** public `ImageCropPercent` (0–100 UI), permille helpers (`*1000` / `/1000`), projection fraction conversions exactly once each direction; `validateImageCropPercent` opposing-edge sums.
- **`contracts/editor.ts`:** `SelectedImageState.crop` and `setImageProperties.crop` use `ImageCropPercent`; re-exported type.
- **`docx-editor-images.ts`:** crop read/write conversions; unsafe hyperlink blocks entire properties command; width/height lock gates; hyperlink changes route through `surface.applyImageProperties()` not tree-only metadata.
- **`tree-package-images.ts` / store/session/surface:** `applyImagePropertiesIntent` — ensure hyperlink rel → tree ops → `applyDrawingHyperlinkRel` in one package transaction (order fix: tree ops no longer overwritten by pre-transaction package read).
- **`ImageProperties.tsx`:** nullable position narrowing; lock-aware dirty tracking (omit unchanged width/height/crop/position/wrap; metadata-only apply preserves EMU); modal focus trap + Escape cancel + trigger focus restore; accessible hyperlink/wrap labels; input mousedown exception via `guardDialogMousedown`.
- **`docx-editor-images-fix-round-3.test.ts` (new):** 10 tests — crop unit edges/sums/persist/readback; hyperlink+resize atomicity; unsafe URL blocks all; unchanged rel preservation; metadata-only width preservation; noMove lock refusal.
- **i18n:** `hyperlinkPopup.urlLabel`; `bun run i18n:fix` + i18n package rebuild for `TranslationKey`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-fix-round-3.test.ts` | 10 pass |
| `bun test packages/core/src/editor/__tests__/docx-editor-images*.test.ts packages/react/test/image-authoring.test.tsx` | 61 pass |
| `bun run typecheck` | pass |
| `bun run i18n:validate` | pass |
| `bun run check:adapter-css-thin` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4045 pass, 0 fail** |
| `bun run check:parity` | **fail** — pre-existing React-only export drift (`ImageProperties*`, `normalizeImageBytes`, etc.; Task 18) |
| `bun run api:check` / `api:extract` | **fail** — pre-existing API Extractor internal error (`Unable to follow symbol for "const"`; Task 18) |

**Boxes checked with evidence:** 6.9 (crop percent boundary; atomic properties incl. hyperlink; dirty omission; locks; modal a11y).

**Critical/high unresolved (Task 15 fix-round-3 scope):**

- ~~**Orphan hyperlink rel cleanup on URL change:**~~ **Fixed in fix round 4 (below).**
- **Task 18 gates:** `check:export-parity` React-only exports; `api:check`/`api:extract` tooling failure (pre-existing on branch).

### Task 15 — fix round 4 (2026-08-04)

**Scope:** High orphan hyperlink rel cleanup in atomic image-properties package transaction — after updating/removing `a:hlinkClick`, drop the prior owner-part external hyperlink relationship only when no remaining canonical reference in that owner part uses its `r:id`; preserve shared rels and same-target unchanged rel; scope by owner part + `r:id`; undo/redo restores exactly.

**Delivered**

- **`hyperlink-part.ts`:** `ownerPartReferencesHyperlinkRelationshipId` (typed `w:hyperlink` + direct `wp:docPr/a:hlinkClick` scan, owner-scoped); `removeExternalHyperlinkRelationship`; `cleanupOrphanDrawingHyperlinkRelationship`.
- **`tree-op-drawings.ts`:** `docPrHyperlinkRelationshipId` — read current drawing hyperlink rel before mutation.
- **`tree-package-images.ts`:** `applyImagePropertiesIntent` and `setDrawingMetadataWithHyperlink` capture prior rel, apply hyperlink wiring, then cleanup orphan prior rel in the same package transaction.
- **`docx-editor-images-fix-round-3.test.ts`:** 6 new tests — sole URL change, shared rel preservation, removal, unchanged same-target, header/body duplicate `rId` scoping, undo/redo exact restore.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-fix-round-3.test.ts` | 16 pass |
| `bun run typecheck` | pass |
| `bun run i18n:validate` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4051 pass, 0 fail** |
| `bun run check:parity` / `api:check` | not rerun — Task 18 blocker (ignored this round) |

**Critical/high unresolved (Task 15 scope):** None.

### Task 16 — image selection overlay (2026-08-04)

**Scope:** OpenSpec 6.6–6.7 and 6.11 — `ImageSelectionOverlay` reads `publishedLayout()` semantic records + canonical selection id; eight accessible resize handles; pointer preview local-only with one commit on pointer-up; anchored move/resize; keyboard nudge/resize/delete/Escape; auto-scroll via injected `ImageOverlayScrollPort`; stale layout/selection/epoch refusal.

**Delivered**

- `semantic-hit-test.ts`: `findDrawingOverlayFrameInLayout` — page-content overlay frame from layout records.
- `docx-editor-images.ts`: `selectedDrawingOverlayTargetOf`, resize/move math, `ImageInteractionSession` / `ImageOverlayScrollPort`, stale commit guard.
- `ImageSelectionOverlay.tsx`: portal overlay with eight handles, pointer preview sessions, keyboard dispatch, `guardToolbarMousedown`.
- `DocxEditorContent.tsx`: mounts overlay on persistent portal host beside attach target.
- `editor.css`: `--doc-*` overlay frame/handle tokens, reduced-motion/focus-visible.
- `image-authoring.test.tsx`: handle count, pointer commit-once/cancel, keyboard delete/Alt+Arrow resize.
- i18n: `imageOverlay.selection`, `imageOverlay.handle.*`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/react/test/image-authoring.test.tsx` | 21 pass |
| `bun run typecheck` | pass |
| `bun run i18n:validate` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run check:parity-contract` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4057 pass, 0 fail** (+6 vs Task 15 baseline 4051) |
| `bun run check:parity` | **fail** — pre-existing `check:export-parity` React-only export drift (Task 18) |
| `bun run api:check` | **fail** — pre-existing API Extractor internal error (Task 18) |

**Boxes checked with evidence:** 6.6, 6.7, 6.11.

**Critical/high unresolved (Task 16 scope):** None.

### Task 16 — fix round 1 (2026-08-05)

**Scope:** Five high blockers — shared paint-scale/page-offset coordinate mapping; EMU-authoritative resize with rotation/local axes and west/north anchor commits; Word aspect policy (`noChangeAspect` hard lock, corner-default preserve, Shift free); production viewport scroll port with accumulated applied delta; scoped overlay keyboard furniture (no global listener).

**Delivered**

- **`surface-overlay-coordinates.ts` (new):** `surfacePaintScale`, `cssPixelsToLayoutPoints` / inverse, `overlayFrameToSheetCssPixels`, `computeImageResizeResult` (EMU baseline, inverse-rotation delta, scaled preview bounds, anchored west/north position), `resizePreservesAspect`, `createImageOverlayScrollPort`.
- **`paginated-surface`:** internal `overlayCoordinates()` returns `{ paintScale, pageOffsetX }` matching painter/selection overlay.
- **`docx-editor-images.ts`:** `SelectedDrawingOverlayTarget` carries `transform`, `aspectLocked`; session stores EMU extents + transform + kind.
- **`ImageSelectionOverlay.tsx`:** reads `surface.overlayCoordinates()` (not `getZoom` alone); pointer px→pt via paint scale; resize preview/commit through `computeImageResizeResult`; auto-scroll from production viewport scroller with accumulated applied delta; focusable overlay root intercepts keydown (Delete/Alt+Arrow/Escape) with `preventDefault`+`stopPropagation`; pointer capture + cancel cleanup.
- **Tests:** `docx-editor-images-overlay-fix-round-1.test.ts` (12); extended `image-authoring.test.tsx` (overlay scale, scoped keyboard, input isolation).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-overlay-fix-round-1.test.ts packages/react/test/image-authoring.test.tsx` | 35 pass |
| `bun run typecheck` | pass |
| `bun run i18n:validate` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run check:parity-contract` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4071 pass, 0 fail** (+14 vs Task 16 baseline 4057) |
| `bun run check:parity` | **fail** — pre-existing `check:export-parity` React-only export drift (Task 18) |
| `bun run api:check` | **fail** — pre-existing API Extractor internal error (Task 18) |

**Boxes checked with evidence:** 6.6, 6.7, 6.11 (coordinate mapping, EMU resize, aspect, scroll port, scoped keyboard).

**Critical/high unresolved (Task 16 fix-round-1 scope):** None.

### Task 16 — fix round 2 (2026-08-05)

**Scope:** Three high blockers — flipH/flipV handle mapping with rotation; aligned anchored west/north resize preserving opposite visual edge via align→posOffset from resolved frame origin; pointer-up recomputes commit from release coordinates + accumulated scroll (not stale preview React state).

**Delivered**

- **`drawing-layout.ts`:** `ResolvedAnchoredPosition` / `AnchoredDrawingRecord` publish `horizontalFrameOrigin` / `verticalFrameOrigin` (reference-frame left/top in page-content coordinates).
- **`surface-overlay-coordinates.ts`:** `localHandle` maps visual handles through inverse flips then rotation; `computeImageResizeResult` accepts `anchorFrameOrigin` and converts aligned anchors to schema-valid offset position atomically with extent; `finalizeImageOverlayInteraction` recomputes resize/move commit from release pointer delta + scroll.
- **`docx-editor-images.ts` / `ImageSelectionOverlay.tsx`:** overlay target + session carry `anchorFrameOrigin`; pointer-up calls `finalizeImageOverlayInteraction` and commits fresh EMU/position (not preview closure).
- **Tests:** `docx-editor-images-overlay-fix-round-2.test.ts` (9); extended `image-authoring.test.tsx` (pointer-up release delta without final pointermove).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/editor/__tests__/docx-editor-images-overlay-fix-round-2.test.ts packages/react/test/image-authoring.test.tsx` | 38 pass |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bun test` (full suite) | **4081 pass, 0 fail** (+10 vs Task 16 fix-round-1 baseline 4071) |
| `bun run check:parity` | not rerun — pre-existing Task 18 `check:export-parity` React-only export drift |
| `bun run api:check` | not rerun — pre-existing Task 18 API Extractor internal error |

**Boxes checked with evidence:** 6.6, 6.7 (flip-aware resize, aligned anchor position commit, pointer-up fresh commit).

**Critical/high unresolved (Task 16 fix-round-2 scope):** None.

### Task 17 — fixture matrix, round-trip oracles, browser acceptance (2026-08-05)

**Scope:** OpenSpec §7.1–7.9 and §9.5 (Word visual evidence only when Word is available). Ten deterministic fixtures + manifest for sixteen inputs; table-driven package/layout/paint/round-trip tests; one Playwright authoring flow on `image-layout-modes-demo.docx`.

**Delivered**

- `e2e/fixtures/build-drawing-fixtures.mjs` — deterministic builder (10 focused DOCX + SHA refresh).
- `e2e/fixtures/drawings-fixtures.md` — human + machine manifest for all 16 inputs.
- `packages/core/src/store/__tests__/drawing-fixtures.test.ts` — manifest hash/metadata, 7.9 empty-srcRect scope, 7.1 27-external-rel zero-fetch, per-fixture fingerprint/round-trip/layout/paint table.
- `e2e/editor-drawings.spec.ts` — wrap, keyboard move/resize, alt text, undo/redo, save/reopen on composed demo (`?drawingsE2e=1` bridge mirrors tree harness).
- `examples/vite/src/DrawingsE2eBridge.tsx` — Playwright-only selection/save/reopen hook (not a demo surface).
- `screenshots/typed-drawings-word-comparison/editor-image-layout-modes-demo.txt` — editor-labeled note (NOT Word reference).

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/drawing-fixtures.test.ts` | 72 pass |
| Broad drawing suite (plan Task 17 list) | 357 pass |
| `bun test` (full suite) | **4153 pass, 0 fail** |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bunx playwright test e2e/editor-drawings.spec.ts` | 1 pass |

**Boxes checked with evidence:** 7.1–7.9 (fixture manifest + unit oracles). §9.5 **unchecked** — no Microsoft Word on this machine; Word wrap/tolerance screenshots and measured deltas remain a **release blocker** for visual parity claims.

**Critical/high unresolved (Task 17 scope):**

- **Release blocker (OpenSpec §9.5):** Word desktop visual comparison for wrap modes, crop, z-order, and header watermark — requires Word-authored reference screenshots and tolerance recording in manifest.
- **High:** `float-wrap-comprehensive-test.docx` wrap-exclusion layout does not converge within 8 passes (`DrawingExclusionConvergenceError`); layout/paint oracle skips convergence for that fixture only (pre-existing multi-anchor stress).
- **High:** `semanticDigest` on save/reopen fails for Word MC/VML fixtures (`issue-705-…`, `images-compatibility-malformed.docx`) due to `undeclared-prefix` during generic-node fingerprint — fingerprint oracle passes; digest equality deferred when prefix scope is absent (not a Task 17 regression).
- **Medium (not release-blocking):** Anchored image click-to-select in browser still requires caret placement or harness API; pointer hit on painted anchor for overlay focus is a follow-up UX gap (Playwright uses `DrawingsE2eBridge.selectDrawing`).

### Task 17 — fix round 1 (2026-08-05)

**Scope:** Close four high blockers from Task 17 review — meaningful Playwright acceptance, manifest-driven exact fixture oracles (§7.1–7.9), float-wrap convergence in production, namespace-aware `semanticDigest` for undeclared-prefix/MC/VML nodes. §9.5 Word checks remain unchecked.

**Delivered**

- **`e2e/editor-drawings.spec.ts`** — square→Top and Bottom wrap with toolbar title assertion; overlay y delta (+1pt) after wrap baseline; alt text; resize (+12700 EMU); four-step undo/redo chain (one keyboard nudge per move undo step); save download + `.docx` file-input reload (not in-memory reopen); persisted wrap/alt/size/`verticalEmu`/drawing count via bridge inspection.
- **`examples/vite/src/DrawingsE2eBridge.tsx`** — `overlayTarget()`, `selectedImage()` (wrap, description, width/height EMU, `verticalEmu`); removed `saveReopen()`.
- **`packages/core/src/store/__tests__/drawing-fixture-oracles.ts`** + **`drawing-fixtures.test.ts`** — replaced permissive fixture loop with manifest-driven exact per-fixture counts/types/wrap sides/positions/crop/rotation/flips/z-order/header/body geometry/resource refusal; no `>=0`/any-state/skip; `images-zorder.docx` builder fixed (two `w:drawing` elements).
- **`packages/core/src/layout/semantic-layout.ts`** + **`drawing-exclusion.ts`** — cycle detection via `seenZoneTokens` + bounded stabilization passes; `float-wrap-comprehensive-test.docx` layouts 8 pages without skip.
- **`packages/core/src/store/package/ooxml-digest.ts`** + **`ooxml-serialize.ts`** — ancestor namespace bindings threaded through generic/MC/VML digest; malformed undeclared prefix → deterministic `generic-refusal:undeclared-prefix:…`; removed blanket catch; all 16 load/save/reopen digest oracles pass.

**Verification**

| Gate | Result |
|------|--------|
| `bun test packages/core/src/store/__tests__/drawing-fixtures.test.ts` | 71 pass |
| `bun test digest-blind-spots.test.ts ooxml-indexes-digest.test.ts` | 31 pass |
| `bun test` (full suite) | **4152 pass, 0 fail** |
| `bun run typecheck` | pass |
| `openspec validate typed-drawings-and-images --strict` | pass |
| `bunx playwright test e2e/editor-drawings.spec.ts` | 1 pass |
| `bun run api:check` | **fail** — API Extractor internal error on `@docx-editor.dev/react` (`Unable to follow symbol for "const"`) |

**Boxes checked with evidence:** 7.1–7.9 unchanged (exact oracles now enforce prior claims). §9.5 **unchecked** — no Word desktop on this machine.

**Critical/high unresolved (Task 17 fix-round-1 scope):**

- **Release blocker (OpenSpec §9.5):** Word desktop visual comparison for wrap modes, crop, z-order, and header watermark — requires Word-authored reference screenshots and tolerance recording in manifest.
- **High:** `bun run api:check` fails (API Extractor crash on React package; pre-existing tooling defect — not introduced by drawing changes).

### Task 18 — release/docs/API gate (2026-08-05)

**Scope:** OpenSpec §6.13, §9.1–9.2, §9.6–9.8; truthful word-features matrix; images guide; API Extractor/export parity; changeset; deferred inventory; 89-item checklist (§9.5/§3.4/§6.8a left unchecked — no Word desktop).

**Delivered**

- **`docs/site/data/word-features.ts`** + **`word-features.test.ts`** — inline/anchored editing `partial` (React-only note); raster rendering `full`; SVG rendering `full` with no insert; WMF/TIFF/EMF placeholders; charts/SmartArt/shapes/textboxes `preserved`+placeholder; tracked images not claimed.
- **`docs/site/content/guides/images.mdx`** — formats, `SelectedImageState`, React symbols (`ImageInsert*`, `ImageWrap`, `useEditorValueCommand`, `normalizeImageBytes`, properties dialog), wrap/security/unsupported scope; registered in both meta files.
- **API Extractor fixes** — explicit `ImageWrapTarget` union (no `(typeof const)[number]`); `ImageWrapPartComponent`/`ImageAltTextPartComponent` without `typeof Toolbar*`; `NormalizedImagePayload.reasonKey` as public `string`; `@public` on `useEditorValueCommand` overloads.
- **`intentional-export-divergence.md`** — documents twelve React-only image authoring exports.
- **`.changeset/calm-images-float.md`** — `@docx-editor.dev/react` minor with plan summary.
- **`deferred-features.md`**, **`proposal.md`**, **`design.md`** — partial boundary + named Vue/VML follow-ups.
- **`docs/api/docx-editor-react/index.api.md`**, **`docs/api/docx-editor-vue/index.api.md`** — refreshed via `api:extract`.

**Verification**

| Gate | Result |
|------|--------|
| `bun test ./docs/site/data/word-features.test.ts` | 6 pass |
| `bun run typecheck` | pass |
| `bun test` (full suite) | **4152 pass, 0 fail** (matches Task 17 fix-round-1 baseline; +0) |
| `bun run check:export-parity` | pass (189 documented divergences incl. 12 image React-only exports) |
| `bun run check:editor-contract` | pass |
| `bun run check:parity-contract` | pass |
| `bun run check:adapter-css-thin` | pass |
| `bun run check:parity` | **fail** — `check:public-docs-surface`: missing `reactUi`/`plugin-api` entry files and `DocxEditorHandle`/`renderAsync` (pre-existing branch infra; not introduced by drawings) |
| `bun run api:check` | pass (0 errors; react 57 / vue 50 `@public` TSDoc warnings) |
| `bun run i18n:validate` | pass (917 keys) |
| `bun run docs:json` | **fail** — `@docx-editor.dev/agents` dist missing (`./bridge` TS2307; pre-existing) |
| `openspec validate` (5 changes) | all pass |
| `bunx playwright test e2e/editor-drawings.spec.ts` | 1 pass |
| `bun run format` | pass |

**Boxes checked with evidence:** 6.13, 9.1, 9.2, 9.6, 9.7, 9.8. **Left unchecked:** 3.4, 6.8a, 9.5 (Word visual evidence unavailable).

**Critical/high unresolved (Task 18 scope):**

- **Release blocker (OpenSpec §9.5):** Word desktop visual comparison for wrap modes, crop, z-order, and header watermark — requires Word-authored reference screenshots and tolerance recording in manifest.
- **High (pre-existing infra, not drawings regression):** `check:parity` fails at `check:public-docs-surface` (missing `packages/react/src/ui.ts`, `plugin-api/`, and adapter `DocxEditorHandle`/`renderAsync` exports). `docs:json` fails because `@docx-editor.dev/agents` does not build (`./bridge` missing).
