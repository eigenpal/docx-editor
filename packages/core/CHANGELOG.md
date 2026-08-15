# @docx-editor.dev/core

## 2.4.1

### Patch Changes

- @docx-editor.dev/i18n@2.4.1

## 2.4.0

### Patch Changes

- @docx-editor.dev/i18n@2.4.0

## 2.3.1

### Patch Changes

- 1c9b6a2: Long documents now reuse pagination after explicit page and section breaks, avoiding full-document work for ordinary typing, wrap-inducing edits, and character, word, line, vertical, or document-edge caret movement. Rapid typing preserves input order while coalescing pending page, toolbar, and review-rail refreshes, and repeated tracked deletions stay compact instead of adding one OOXML run per keypress.
- 1c9b6a2: Rapid typing no longer reorders characters when a deferred paint leaves the DOM caret behind the model. Native and touch carets that return to that leftover offset still edit there.
  - @docx-editor.dev/i18n@2.3.1

## 2.3.0

### Patch Changes

- @docx-editor.dev/i18n@2.3.0

## 2.2.1

### Patch Changes

- 35f6d04: Fix exported comment replies opening as separate comments instead of a thread in Microsoft Word.
  - @docx-editor.dev/i18n@2.2.1

## 2.2.0

### Minor Changes

- 3096225: The document now fits its container by default, so a narrow window shrinks the page instead of overflowing it and opening the comments pane shrinks the document rather than pushing it off screen. Drive it with `Editor.setZoomMode` or React's new `useZoom` hook, and pass `zoomMode={{ type: 'fixed' }}` to keep the old behavior.

### Patch Changes

- 9c25492: Keep legacy FORMTEXT result text editable with character-accurate caret and selection offsets.
- 04c2379: Programmatic selections made while embedded fonts load now keep their range and visible highlight after the shaped-font remount.
- f0e4ab9: Tracked changes on a field's result now render as tracked. A deletion or insertion around the value of a cross-reference, page number or form field previously painted as ordinary unchanged text, so a reviewer saw no strikethrough or author colour on an edit the review sidebar was reporting correctly. A paragraph containing such a field also measured longer than what was laid out from it, which put the caret and the keystroke at different offsets — clicking after the field placed the cursor in one place and typing appeared in another. `w:fldSimple` now paints its cached result instead of blank space, allowlisted PAGE/NUMPAGES/SECTIONPAGES nested inside a non-page simple field evaluate per sheet rather than reusing the saved cache, and field results carry Word's grey field shading — always for legacy form fields unless the document sets `w:doNotShadeFormData`, and per the new `fieldShading` option (`never` / `when-selected` / `always`) for the rest.
- Updated dependencies [568ccf7]
  - @docx-editor.dev/i18n@2.2.0

## 2.1.3

### Patch Changes

- @docx-editor.dev/i18n@2.1.3

## 2.1.2

### Patch Changes

- efd3d76: Menus and popovers now paint above the editor's own furniture. Toolbar dropdowns, the menu bar, colour pickers and the hyperlink popover sat at a lower z-index than the navigation gutter and table chrome, so opening File put the menu underneath the navigation toggle. Layering is now three `--doc-z-*` tokens (`chrome`, `overlay`, `context`) rather than a dozen hand-picked numbers.
- 69a97f3: `setActiveReviewItem` and `useReview().setActive` take a `reveal` option, so a host can choose where an activated change lands instead of taking the engine's default: `'start'`, `'center'`, `'centerIfNeeded'`, `'nearest'`, or `false` to select the item without moving the viewport at all.
- ede69f6: Activating a review card now reports whether it landed. `setActiveReviewItem` returns an `ExecResult` and `useReview().setActive` a boolean, so a host walking the queue with next/previous controls can tell a step that did nothing from one that worked — activation is refused for an unknown key, an item with no range, a story that will not open, and a revision kind the rail excluded. Review items carry a matching `activatable` flag, so a card that cannot be clicked can be drawn that way instead of discovering it on click.
- 802ab3e: The collapsed review rail now draws a glyph for what each marker actually is — an insertion, a deletion, a formatting change, a comment or a custom node — instead of one comment bubble for every kind. A custom node names its own through `reviewCard`'s new `icon`, and the `Markers` part takes an `icon` of its own for a host that wants to draw all of them itself.
- 4fa91bd: The painted-document rules are now scoped to the editor. Around a hundred `.layout-*` and `.paged-editor*` selectors shipped unscoped, so a host with its own `.layout-page-header` or `.layout-page-content` had those elements restyled by the editor's stylesheet. The class names are unchanged; only the rules moved under `.docx-editor`. The stylesheet guard now exempts `.docx-` alone, so nothing else can ship unanchored.
- 4fa91bd: The y-prosemirror remote-cursor styles are now scoped to the editor. `.ProseMirror-yjs-cursor` is y-prosemirror's class name rather than one the engine mints, and it shipped unscoped, so a host running its own ProseMirror editor with Yjs on the same page had its remote cursors restyled. The stylesheet guard no longer treats `.ProseMirror-` as an engine-owned namespace.
  - @docx-editor.dev/i18n@2.1.2

## 2.1.1

### Patch Changes

- d74c5d6: Jumping to a tracked change or a selection now lands on it: the reveal was measuring caret geometry against the top of the sheet rather than the page's content box, so every jump stopped one page margin short and left the target just under the fold. Reveals that have to travel now centre their target instead of stopping the moment it clears the bottom edge, and one that is already on screen still does not move.
  - @docx-editor.dev/i18n@2.1.1

## 2.1.0

### Minor Changes

- a9fd363: BMP and WebP images now render instead of showing an unsupported-format placeholder.
- 3310029: Custom nodes can carry a payload larger than the 64-character `w:tag` cap, in a customXml data part an SDT binds to, with a sweep that collects payloads whose control was deleted and a removal that leaves no record of the store for documents exported outside the system.
- d116599: Custom nodes can be inserted, updated and removed inside a header, footer or note, including a node carrying a payload: the control lands in that story while its customXml store stays on the main document part, where Word looks for it. Which story a write targets now comes from the node or paragraph id rather than from wherever the reader happens to be, so a caller can address a node in a story it has left. Inserting, updating and removing all refuse a document open for viewing instead of editing it — these writes go through the store, below the editing-mode gate — and report the same `locked` code the engine's own refusal uses.
- dbf5501: Every remaining `ep-` prefixed CSS class and keyframe is renamed to `docx-editor-`, so the whole stylesheet shares one namespace with the `.docx-editor` root class. If your own CSS targets an `.ep-*` class or the `ep-caret-blink` keyframe, switch it to the same name under `docx-editor-` (`.ep-one-surface__caret` becomes `.docx-editor-one-surface__caret`).
- 8b4830e: Review navigation now goes where it says it does: activating a card selects the item's whole range and scrolls to it even when your own UI holds focus or the target page is not yet materialized, walking from a header change back to a body change leaves the header story so the body card activates again, and the `setSelection` command reveals its target. New `setReviewActivationExclusions` lets a host rail tell the engine which revision kinds it hides, so clicking tracked text never opens a card the rail does not render.
- 7a72c42: Tracked changes and comments inside footnotes and endnotes now reach the review queue. They get cards with real geometry, `getTrackedChanges` names the story holding them, the caret can make one active, opening a card enters that note, accept and reject resolve against the note's own part, and a note card can be replied to — commenting anywhere after a note reference was refused before, because the offset walk counted note marks as no characters. Commenting outside the body works the same way: a range selected in a header, footer or note offers the affordance and the comment lands in that story. `focus(scope)` honours its argument, and a scope it cannot open is refused without first closing the story the reader had open.
- 43c3e6a: The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility, editable-surface rule and keyframe is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles the chrome correctly in hosts without Tailwind. If your own CSS targets `.ep-root`, switch it to `.docx-editor`.
- d793994: TIFF images now render instead of reserving their extent behind a placeholder. The image decode port's `convertMetafile` hook is renamed to `convertPreserved` and receives TIFF alongside EMF and WMF.

### Patch Changes

- d793994: The caret now carries a contrasting ring, so it stays visible against dark content. Clicking beside a dark image, or arrowing onto the line one sits on, no longer leaves the insertion point invisible.
- 6dee1e3: Comment markers now land on the character they were asked for in paragraphs holding a drawing, a field or an inline content control, and a comment can be anchored inside a content control at all. The comment writer measured those paragraphs with a walk of its own that counted such elements as nothing, so commenting near one was either refused outright or, worse, placed the marker silently on the wrong character. A marker at the far edge of a complex field is also placed after the whole field rather than among its parts, where Word would drop it on the next field rebuild.
- f4eac0c: Update fast-xml-parser to 5.10.1.
- b3e3457: Pin the node and mark name unions on `treeSchema` so the generated type declaration is identical between builds.
- 7dce3ba: Keep sub-1pt drawing extents at full paint height so Word's hairline form-rule bars stay visible instead of shrinking to a sub-pixel clip.
- a758db1: Fix images in a header or footer staying on the loading placeholder forever. The picture decodes, but the page kept the furniture it was laid out with, so it never showed.
- 42406bc: Header and footer ink now overflows its band like Word instead of being clipped: anchored shapes offset past the content width or below the header text stay visible, and negative indents hang into the margin. Overflowing shapes stay inert until the band is edited, so they never swallow clicks meant for the body.
- d793994: Fix a band of blank space under an inline image in a paragraph using multiple line spacing. The multiple now scales the text line, as Word does, instead of the image's own height.
- d89ef55: Stop binding Cmd+R for right alignment on macOS: the browser reserves that chord for reload, so the old binding re-aligned the paragraph and the page still reloaded. Right alignment stays on Ctrl+R on every platform.
- d56b1a5: Speed up the document pipeline on long documents: opening, laying out, editing and saving a 500-page document is roughly a third faster end to end, and unchanged-document layout passes drop by more than half. Parsing, validation, layout keying and serialization now avoid recomputing facts already proven for unchanged, immutable nodes; no validation or security bound changed.
- 34be525: Apply Word's automatic paragraph spacing when `w:beforeAutospacing` or `w:afterAutospacing` is set, instead of the measurement the flag replaces. Documents written by Word's HTML filter carry it on every paragraph and were laid out 9pt tight per boundary, which moved page breaks.
- 765e617: Stop applying paragraph-mark `w:pPr/w:rPr` font size to content runs that inherit the paragraph style. Mark formatting still sizes empty lines and last-line mark height.
- 113ed44: Tracked changes from other editors now coalesce the way Word shows them: adjacent same-author deletions or insertions merge into one review card, and a deletion meeting an insertion pairs into a single Replaced card regardless of how far apart their timestamps are.
- 3f70246: Speed up comment and tracked-change derivation on heavily reviewed long documents: re-reading the review queue over an unchanged document is ~25x faster, and the re-derive after an accept, reject, comment write or undo drops by more than half. Derivation semantics are unchanged.
- 8b4830e: Review and navigation now land in the story they name: accepting or rejecting a header or footer card leaves the caret inside that story instead of throwing it into the body (after which every keystroke was silently refused), replying to a header or footer card writes into that part instead of being refused, and jumping to a body search hit or outline heading leaves an open header or note first.
- 585413d: Fix caret and hit-test drift on lines containing superscript or subscript text. The shaped measurer rounded the reduced super/subscript size to a whole half-point, measuring those runs up to 3% wider than they paint; the caret landed mid-glyph for the rest of the line.
- cc82d50: Pictures inside footnotes, endnotes and text boxes now render. They previously painted nothing at all, not even a placeholder.
- ec538fa: Fix suggesting mode dropping text typed at the start of a paragraph that carries properties, which made the keyboard look dead in the item Enter had just opened. An empty list item's marker also no longer paints over the item above it.
- 45c9b93: Anchored text boxes now render their content clipped inside the shape's extent in the body, headers, and footers, with PAGE / NUMPAGES / SECTIONPAGES fields inside header/footer text boxes evaluated per page. Editing a header or footer whose direct content is nearly empty now shows a full-height edit band instead of a hairline.
- 0a62c6d: Typing in a tracked table row no longer drops that row's tracked-change card, so the row insertion stays acceptable and rejectable.
- e215962: Trailing tabs no longer start a new line, so a header authored as tabbed columns keeps its own height and stops pushing the body down the page. Header and footer shapes marked `behindDoc` now paint beneath the body text instead of over it.
- 434454d: Paint form-blank underlines across tab advances: an underlined `w:tab` now draws a rule for the reserved stop width instead of relying on CSS text-decoration on an invisible tab glyph.
- Updated dependencies [232728c]
  - @docx-editor.dev/i18n@2.1.0

## 2.0.1

### Patch Changes

- 51f14f5: Add the `repository` field to the core package manifest so npm can verify its provenance statement on publish.
  - @docx-editor.dev/i18n@2.0.1

## 2.0.0

### Major Changes

- 26095c6: Initial release.

  A WYSIWYG `.docx` editor that runs entirely in the browser: it opens a Word file, paints
  the real paginated layout, edits it in place, and writes a `.docx` back out.
  - `@docx-editor.dev/react` — the React adapter. `<DocxEditor document={bytes} />` for the
    packaged editor, or compose `DocxEditor.Root` / `.Viewport` / `.Content` with the hooks
    (`useEditorState`, `useEditorCommand`, `useDocxEditor`) to build your own chrome.
  - `@docx-editor.dev/core` — the framework-agnostic engine: OPC/XML reading, the canonical
    OOXML tree, layout, paint, and the `Editor` contract the adapters render.
  - `@docx-editor.dev/i18n` — the shared string catalogue, with nine locales.
  - `@docx-editor.dev/editor-api` — a batching document object model for automating a
    document from a server or from an editor already open in a page.
  - `@docx-editor.dev/pro` — tracked changes, comments, and custom nodes.

  Word fidelity is structural: styles, theme colours, tables, headers and footers, section
  layout, numbering, and tab stops resolve through the same cascade Word uses, and content
  the editor does not model round-trips untouched.

- 26095c6: `setSelection` now types the forms it actually accepts. `EditorSelection` gained the
  `{ anchor, head }` paragraph-id pair the engine honours, and lost the `SemanticTarget` and
  `DocLocation` arms it never accepted, so the outline and any other caller can move the caret
  without a cast.

  Breaking if you passed a `SemanticTarget` or a `DocLocation`-ended range to `setSelection`:
  both were refused at runtime with `unsupported`, so working code is unaffected.

- 26095c6: Remove `EditorHost`, `EditorConfig` and `createEditor` from the public surface. They described a retired pipeline in which the adapter supplied DOM handles and a display sink; the editor has painted its own surface since `createDocxEditor` replaced it, and none of the three had a caller. Use `createDocxEditor` with `DocxEditorConfig`.

### Minor Changes

- 26095c6: Put the caret in the right place on an empty paragraph. A centred or right-aligned one drew it at the left margin, and one with a first-line indent ignored the indent; in both cases it only jumped to the correct position once a character was typed. Lines now publish their aligned content origin as `LineRecord.contentX`.
- 26095c6: The root entry and the `contracts/*` entries now export the types their own signatures hand
  out — `CanResult` from `can()`, `TextMatch` from `findText()`, `TableContext` from `query()`
  and around 60 more that were previously unnameable from the entry point that returns them.
  The root re-exports the whole `Editor` contract rather than a hand-listed subset, so it cannot
  drift from it again.

  Removes `@docx-editor.dev/core/contracts/plugin` and `@docx-editor.dev/core/contracts/mcp`.
  Every function in them threw, and `coreTools` had no runtime binding at all. Extensions and
  MCP are deferred to a separately specified contract; `EditorModule` is the supported seam.

### Patch Changes

- Updated dependencies [26095c6]
  - @docx-editor.dev/i18n@2.0.0
