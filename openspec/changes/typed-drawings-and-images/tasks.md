## 0. Baseline before code

- [ ] 0.1 Load `comprehensive-word-element-test.docx` in the demo and capture browser evidence of the eleven drawings today. The expected finding is that none paints and none reserves space, so the pagination around them is wrong — confirm rather than assume
- [ ] 0.2 Record the page count and the position of the paragraphs surrounding each drawing, so the after-picture is comparable
- [ ] 0.3 Re-read `openspec/changes/typed-ooxml-paragraph-editor/baseline.md` and record the current `bun test` result
- [ ] 0.4 Confirm with review that the D8 boundary expansion — drawing nodes, picture payload, anchoring and wrap — is accepted before typing any node

## 1. Typed nodes

- [ ] 1.1 Add `drawing`, `inlineDrawing`, `anchoredDrawing`, `picture` to the node-kind union in `ooxml-tree.ts`
- [ ] 1.2 Type `CT_Inline` and `CT_Anchor` with every attribute named in the proposal
- [ ] 1.3 Type the wrap vocabulary: `CT_WrapNone`, `CT_WrapSquare`, `CT_WrapTight`, `CT_WrapThrough`, `CT_WrapTopBottom`, with `ST_WrapText` and the polygon
- [ ] 1.4 Type `CT_PosH` / `CT_PosV` with `ST_RelFromH`, `ST_RelFromV`, and the align/offset choice
- [ ] 1.5 Type `CT_Picture`: `a:blip` (`r:embed` / `r:link`), `a:srcRect`, fill mode, `a:xfrm` with rotation and flips, `a:prstGeom`
- [ ] 1.6 Non-picture graphic data stays a generic payload under a typed drawing
- [ ] 1.7 Preserve `wp:docPr/@name` and `@descr` exactly; never generate either
- [ ] 1.8 Re-emit an empty `a:srcRect` as empty; assert canonical-fingerprint equality across all eleven fixture drawings unedited

## 2. Media, resources, and security

- [ ] 2.1 Resolve `r:embed` through the existing safe-target rules; refuse a target containing `..` or a leading `/`
- [ ] 2.2 Validate decoded bytes against the declared content type; placeholder on mismatch
- [ ] 2.3 Enforce dimension and byte-size bounds in `store/runtime/limits.ts` **before** any allocation sized by a file-supplied number
- [ ] 2.4 **Never fetch** `r:link` or a `TargetMode="External"` image relationship at load, layout, paint, or save. Add the test that asserts zero network requests for such a document
- [ ] 2.5 Explicit-gesture path for loading an external image, with scheme allowlisting
- [ ] 2.6 Sanitize `a:hlinkClick`; activation requires a gesture and an allowlisted scheme; the authored value is preserved escaped on save
- [ ] 2.7 Decode a shared media part once; refcount it against live drawing references

## 3. Layout — inline

- [ ] 3.1 Inline drawing occupies `wp:extent` as an unbreakable line item with baseline alignment
- [ ] 3.2 `@distL` / `@distR` as horizontal spacing
- [ ] 3.3 Wrap to the next line when it does not fit; grow the line when taller than its text
- [ ] 3.4 **Settle the wider-than-content-box behaviour against a Word comparison** and implement it consistently
- [ ] 3.5 Caret steps over an inline drawing as one unit; a selection spanning it includes it

## 4. Layout — anchored

- [ ] 4.1 Resolve `positionH` / `positionV` against every `ST_RelFromH` / `ST_RelFromV` frame; page-relative means page-relative
- [ ] 4.2 Honour `@layoutInCell` inside a table
- [ ] 4.3 Exclusion zones per wrap mode, including insets, as a line-breaking input rather than a paint-time clip
- [ ] 4.4 **Decide and record** whether tight and through use the real `wp:wrapPolygon` or a bounding-box approximation. If approximated, say so in the spec — do not approximate silently
- [ ] 4.5 Paint order from `@behindDoc` and `@relativeHeight`; displacement under `@allowOverlap="0"`; paint order changes no layout
- [ ] 4.6 Named fallback and a reported reason for an unresolvable frame
- [ ] 4.7 **Assert the header rule**: a header containing a page-relative anchored drawing is still sized by story flow height, and the body area is not pushed down by the drawing's extent

## 5. Paint and unrenderable formats

- [ ] 5.1 Paint decoded images at their laid-out geometry with crop and transform applied
- [ ] 5.2 TIFF, EMF, WMF, undecodable media, and non-picture graphics reserve their extent and paint a labelled placeholder
- [ ] 5.3 Placeholders name the reason and never claim support
- [ ] 5.4 Every file-derived string in a placeholder is set as text content, never assigned as markup

## 6. Operations and the React surface

- [ ] 6.1 insert-image, replace-image, delete-image, resize-image, set-image-crop, set-image-alt-text, set-wrap-mode, set-anchor-position in `tree-ops.ts` and siblings
- [ ] 6.2 Insert adds part, override, and relationship in one transaction; validates bytes before writing anything
- [ ] 6.3 Delete refcounts the media part; resize and crop leave media byte-identical
- [ ] 6.4 Impact class no narrower than `flow-structural` for extent and wrap changes
- [ ] 6.5 Enable `image.insert` and `image.properties`: change `state` from `{kind:'parityOnly'}` to `{kind:'command'}` **and** add `SLOT_COMMANDS` rows. A row alone leaves them rendering `formattingBar.unavailableInPreview`. Resolve how the `contextual: true` `image` group reaches the default bar. Add `image.wrap` and `image.altText` — ids are public API forever
- [ ] 6.6 Resize handles positioned from layout records, one history entry per drag, preview without committing
- [ ] 6.7 Anchored drag writing `wp:posOffset` against existing frames, with edge auto-scroll
- [ ] 6.8 Wrap menu, including inline↔floating conversion in one transaction
- [ ] 6.9 Properties dialog: size, crop, alt text, position; reset-to-natural-size from intrinsic dimensions and DPI
- [ ] 6.10 Alt text to assistive technology; a drawing with neither `@descr` nor `@name` is exposed as decorative
- [ ] 6.11 Keyboard resize with a defined step; chrome mousedown `preventDefault()` except on INPUT/SELECT/TEXTAREA
- [ ] 6.12 i18n keys, `bun run i18n:fix`, `bun run i18n:validate`
- [ ] 6.13 `bun run api:extract`, `bun run check:parity`

## 7. Fixtures — the comprehensive file covers inline layout and one square wrap, nothing else

- [ ] 7.1 Use `list-pagination-break.docx` for the external-relationship rule — it already carries 27 `TargetMode="External"` image relationships. Author `images-external.docx` only for the `r:link` form if that file lacks it.
- [ ] 7.2 Start from `float-wrap-comprehensive-test.docx`, `image-layout-modes-demo.docx`, and `issue-705-anchored-header-letterhead.docx`, which already cover `wrapTight`, `wrapThrough`, and `wrapTopAndBottom`; author only the missing `ST_WrapText` sides and the `wrapNone` case
- [ ] 7.3 `images-crop.docx` — a real non-empty `a:srcRect`. **This is a genuine repository-wide gap**: no fixture anywhere has one, so cropping is untestable until it exists
- [ ] 7.4 `images-zorder.docx` — two overlapping anchored drawings with differing `@relativeHeight`, one `@behindDoc="1"`, and one `@allowOverlap="0"`
- [ ] 7.5 `images-formats.docx` — JPEG, GIF, SVG, TIFF, EMF, and WMF, to exercise decode and placeholder paths
- [ ] 7.6 `images-header.docx` — a page-relative anchored drawing in a header, to pin the header-sizing rule
- [ ] 7.7 `images-nonpicture.docx` — a chart, a group, and a text box, to pin extent-plus-placeholder
- [ ] 7.8 `images-transform.docx` — rotation, `@flipH`, `@flipV`
- [ ] 7.9 Keep the comprehensive fixture as the inline-layout and round-trip fixture, and record that its `a:srcRect` elements are empty so nobody reads it as crop coverage

## 9. Verification and honest scope

- [ ] 9.1 **Vue is not done.** `paragraph-adapter-acceptance` gates production support on paired adapters; React only by request. Open the follow-up before merge; do not describe the lane as supported
- [ ] 9.2 Rewrite the drawings entry in `deferred-features.md`; keep the entry
- [ ] 9.3 D9: canonical fingerprint on unedited round trips; media parts byte-identical unless replaced; save/reopen semantic digest after resize, crop, and wrap change
- [ ] 9.4 Full-vs-incremental differential test over a wrap-mode change that re-flows several pages
- [ ] 9.5 Visual comparison against Word for each wrap mode, recorded in `screenshots/`
- [ ] 9.6 `bun run typecheck`, `bun test`, `bun run api:check`, `bun run i18n:validate`, `openspec validate typed-drawings-and-images --strict`
- [ ] 9.7 Report any bypassed or still-failing gate as failing
- [ ] 9.8 `bun run format`

## 10. Explicitly out of scope

- [ ] 10.1 A TIFF / EMF / WMF converter — placeholders reserve the correct space; a converter is its own change
- [ ] 10.2 Charts, SmartArt, groups, and canvases — extent plus placeholder, not support
- [ ] 10.3 Text boxes — they contain flowable stories and belong with the story work, not with pictures
- [ ] 10.4 `a:effectLst` shadows, reflections, and artistic effects
- [ ] 10.5 VML (`w:pict`) — a separate vocabulary. **Watermarks live here and `scoped-header-footer-editing` also defers them; assign an owner before either change merges**
- [ ] 10.6 Tracked deletion of a drawing — owned by `typed-revisions-and-comments`

## 11. Review findings to close first

See `openspec/changes/word-fidelity-review-findings.md`.

- [ ] 11.1 **Decide `mc:AlternateContent` handling before typing anything.** Word wraps shapes, text boxes, and `wp14` anchors in `mc:Choice`/`mc:Fallback`; under D1 the wrapper demotes to generic and the anchor never types — on most real files (finding 2.1)
- [ ] 11.2 Reconcile `EditorSnapshot.image.wrap` (no `through`, conflates `@behindDoc`) and `Editor.getSelectedImage()` (no wrap/crop/alt) with the shipped contract (finding 1)
- [ ] 11.3 Add `@hidden` on `CT_Anchor` and `a:CT_NonVisualDrawingProps` — a hidden drawing that paints is a visible defect. Add `@title` alongside `@descr`; Word's alt-text UI writes both, and the current fallback would announce `name="Picture 3"`
- [ ] 11.4 Honour `@locked` and `a:graphicFrameLocks` (`noResize`, `noSelect`, `noMove`, `noChangeAspect`) before presenting handles
- [ ] 11.5 `wp:simplePos` is a required child and `@simplePos="1"` overrides `positionH`/`positionV`; only the positionH/V path is specified
- [ ] 11.6 Wrap distances come from the **wrap element's own** `distT/B/L/R`, not the anchor's, and `wp:effectExtent` widens both reserved space and wrap bounds
- [ ] 11.7 `a:xfrm/@rot` is in 60000ths of a degree, `wp:extent` is the rotated bounding box while `a:xfrm/a:ext` is unrotated, and `a:prstGeom` **clips** rather than merely round-tripping
- [ ] 11.8 Model `a:blip` effects at least enough for watermarks — `a:lum`+`a:grayscl` is how Word writes a washed-out watermark image, which would otherwise paint at full saturation over the text
- [ ] 11.9 Add a demotion rule for malformed drawings — a `wp:anchor` in inline position, a non-numeric `wp:extent`, two children
- [ ] 11.10 `wp:docPr/@id` is required and must be allocated by insert-image
- [ ] 11.11 Own or explicitly defer `w:object` (OLE, `@progId`, `@updateMode`) and `w:altChunk` — the latter pulls another part's content into the flow and deserves the same explicit refusal as `TargetMode="External"` (finding 2)
- [ ] 11.12 Add the missing `## MODIFIED` spec delta for `core-image-commit`
- [ ] 11.13 Assign the watermark owner with `scoped-header-footer-editing` (finding 3)
