# Design — typed drawings and images

## Context

`typed-ooxml-paragraph-editor` is the production authority; this change is the named future gate for its drawings lane.

Layout is deferred today, so a `w:drawing` occupies no space and paints nothing. The comprehensive fixture has eleven and four PNG parts, all present in the package and none visible. The text reflows into the space the pictures should hold, so the document is not merely missing images — its pagination is wrong.

## D8 boundary review

The D8 expansion for this lane adds typed `w:drawing`/DrawingML picture nodes, inline and anchored layout, wrap exclusion, embedded-media validation, and image store operations. **Approved in user session 2026-08-04** against the written design at `docs/superpowers/specs/2026-08-04-typed-drawings-and-images-design.md`. This entry is the boundary-review evidence for task 0.4; it does not substitute for full change review sign-off.

## Decisions

### I1: Inline and anchored are different layout problems and one model

`CT_Inline` and `CT_Anchor` share a payload and share nothing else. An inline drawing is an unbreakable item in a line. An anchored drawing is positioned against a frame and produces an exclusion zone other content flows around.

Typing them as two node kinds under one `drawing` parent keeps the picture payload, the media resolution, and the operations shared, while letting layout dispatch on the anchoring form without inspecting `localName`.

### I2: The exclusion zone is a line-breaking input, not a paint-time clip

Wrap is often implemented as "paint the image on top and hope". That produces text under images and reveals itself the moment a wrap side is `left` or a polygon is tight. Line breaking must know the available width per line band before it measures.

This is also why wrap-mode changes are `flow-structural`: they change what fits on every line beside the drawing.

### I3: `wp:extent` is authority, decoded dimensions are not

`wp:extent` is what Word laid out with. The decoded image's intrinsic size can differ — a 96-DPI PNG placed at 3 inches is not 3 inches of pixels — and using it would change pagination against the authored file.

Intrinsic dimensions are used for exactly one thing: reset-to-natural-size, which is an explicit user action.

### I4: An anchored object never sizes a header box

This rule already exists in `hf-layout.ts` and it is the kind of rule that gets lost when drawings arrive:

> That flow height — never an anchored-object extent — is what sizes the box on every page

An anchored letterhead in a header, positioned page-relative and extending down the page, would otherwise inflate the header box and push the body content area past the page. Restating it as a requirement with a scenario means the drawing work cannot quietly undo it.

### I5: No zero-click fetch, and it is a spec requirement rather than a code convention

An image relationship with `TargetMode="External"` is a URL from an attacker-controlled file. Fetching it on open is an SSRF vector, an IP-leak, and a tracking beacon, and it happens before the user has done anything.

The requirement is written as "loading, laying out, painting, and saving perform no network request", with a scenario, so a reviewer can check it and a test can assert it. Preserving the relationship while refusing the fetch keeps the file intact and the user safe.

`list-pagination-break.docx` carries 27 image relationships with `TargetMode="External"`, so this claim is testable against an existing fixture.

### I6: Unrenderable is not the same as absent

TIFF, EMF, and WMF are common in real documents and no browser decodes them natively. Three options: omit (pagination wrong, silent), broken-image icon (looks like a bug), or reserve the extent and paint a labelled placeholder.

The third keeps pagination correct — the surrounding text lays out exactly as Word does — and makes the state diagnosable. A converter is a separate change; it should not be a prerequisite for correct pagination.

The same treatment covers charts, SmartArt, groups, and text boxes: typed as a drawing, generic graphic payload, extent reserved, placeholder painted. This is honest, and the requirement says explicitly that it is not support.

### I7: Media parts are shared, so deletion is refcounted

Three drawings in the fixture reference `rId14`. Deleting one drawing and removing the part would break the other two. Deleting the last one and keeping the part leaves the file growing on every edit. The part lifecycle is refcounted against live references, in the same transaction as the drawing edit.

### I8: Resize and crop never touch bytes

`wp:extent` is display size; `a:srcRect` is a crop rectangle in percentages. Neither requires re-encoding, and re-encoding would lose quality, change the file on every resize, and break byte-identity for media parts — which D9 requires for non-XML parts.

### I9: A drag is one history entry

A pointer-move-per-op drag produces hundreds of `ModelChange`s, hundreds of layout passes, and an undo stack the user cannot use. Live feedback is a preview; the commit happens on release. This matches D10's rule that one user intent is one semantic history entry.

### I10: mc:AlternateContent branch selection is projection-only

For `mc:AlternateContent`, the wrapper and every `mc:Choice` and `mc:Fallback` branch are preserved exactly in the canonical tree. The bounded semantic projector selects the first `mc:Choice` whose `Requires` namespaces are all supported; otherwise it selects `mc:Fallback`. Only the selected branch contributes a semantic drawing; save emits every authored branch.

### I11: simplePos overrides positionH/V when declared

When `wp:anchor/@simplePos="1"`, the required `wp:simplePos` child is authoritative for x/y. There is no `wp:simplePos/@use`. `wp:positionH` and `wp:positionV` remain preserved but do not drive placement in this case.

### I12: Rotation, effect extent, and exact wrap polygons

Rotation is read in 60000ths of a degree. `a:xfrm/a:ext` is unrotated source geometry; `wp:extent` is the authored rotated layout bounding box. `wp:effectExtent` expands paint, hit, reserved, and exclusion bounds on its respective edges before wrap distances apply. `wrapTight` and `wrapThrough` use the authored `wp:wrapPolygon` mapped through scale, crop, flips, and rotation — not a bounding-box approximation. Overlap displacement under `@allowOverlap="0"` is deterministic.

### I13: Accessibility and hidden metadata

`wp:docPr/@hidden` and equivalent non-visual drawing properties suppress paint, hit testing, and authoring handles while remaining preserved. Accessibility uses `@descr`, then `@title`; `@name` is an authored object name, never announced as alt text. A drawing without description or title is decorative.

### I14: Selected-image state is canonical

`EditorSnapshot` and `Editor.getSelectedImage()` share one `SelectedImageState` type with reference-stable nested state until values change. All nine wrap choices are readable, writable, and reported through shared chrome value state.

### I15: DrawingML image watermarks; VML deferred

This change owns DrawingML image watermark rendering (`a:lum`, `a:grayscl`, behind-text layering, transforms, crop, image paint) and fills `Editor.getWatermark()` for supported DrawingML image watermarks. VML watermarks (`w:pict`) are owned by the named follow-up `typed-vml-watermarks`.

## Resolved questions

1. **Overflow behaviour for an image wider than the content box.** Word clips; the engine retains authored extent, clips at the content box and page paint boundary, and never implicitly scales. Task 3.4 implements against Word comparison fixtures.

2. **Tight and through polygons.** Exact transformed polygon exclusion with wrap distances and effect extent — not a bounding-box approximation. See I12.

3. **Text boxes and groups.** Deferred to a future story change; here they reserve extent and paint a labelled placeholder.

4. **Watermarks.** DrawingML image watermarks: this change. VML: `typed-vml-watermarks`. Header/footer scope: `scoped-header-footer-editing`.

5. **Interaction with tracked changes.** Suggesting-mode drawing deletion returns `trackedDrawingDeletionUnsupported`; owned by `typed-revisions-and-comments`.

6. **Vue parity.** Deferred to `vue-drawing-authoring-parity`; React ships authoring chrome; shared engine commands and `toolbarCommandState` are available in Vue but value/overlay UI is not. No paired-support claim until that follow-up lands.
