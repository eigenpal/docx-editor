# Browser-first checkpoint evidence (tasks 2.2–2.5)

> Historical evidence for the superseded pre-tree checkpoint. Paths and architecture below are not current design authority.

Surface: the production React `DocxEditor` at
`http://localhost:5273/?browserFirst=1&fixture=editable-sample.docx`, hosting a visible
ProseMirror `contenteditable` inside a page-like sheet. Not a pagination claim (D11).

Gate: `e2e/browser-first-paragraph.smoke.spec.ts`, 8 tests, run with
`bunx playwright test --config browser-first.config.ts` from `e2e/`. All assertions that
matter read the result back through `EditorDriver.saveAndReopenText()` — the canonical
model after a save and reopen — so a projection that looks right but committed nothing
fails.

Two things had to be fixed before that gate was usable at all, and both were costing
minutes per run rather than failing honestly:

- **It booted a Vue dev server it never touches.** `editor-smoke.config.ts` declares both
  demo servers because its specs assert React/Vue parity. This checkpoint has no Vue side
  — paired adapter work is section 11, after the engine behavior stabilizes — so it now has
  its own React-only `e2e/browser-first.config.ts`.
- **Navigation waited on the public internet.** The demo shell pulls a Material Symbols
  woff2 from `fonts.gstatic.com`; when that request hangs the `load` event never fires, so
  `page.goto` timed out at 30s while the editor underneath was ready in under a second.
  The spec now navigates with `waitUntil: 'domcontentloaded'` and waits for the driver,
  which is the actual precondition. Run time went from 3.7 minutes of timeouts to ~50s
  green.

Browser captures: `screenshots/browser-first/` (8 stills plus a video of the whole flow).

## Proven in the browser

- Click places the caret where it landed, and the next keystroke edits there.
- Double-click selects a word; typing replaces exactly that word.
- Drag selection and Shift+Arrow extension; Backspace removes exactly the range.
- `Mod-A` selects the whole body.
- Enter splits a paragraph, the new block gets a new canonical identity, and it accepts
  text immediately.
- Backspace at a paragraph start joins into the previous paragraph.
- `Mod-B` bolds the selection and the run reopens as `<w:rPr><w:b/></w:rPr>`.
- Undo/redo run on the canonical store, including reversing a split.

## Defects found by driving the browser, and fixed

### 1. Intercepted edits read a stale ProseMirror selection

`packages/engine-binding/src/edit-surface.ts`

ProseMirror learns a pointer-made selection from the document's asynchronous
`selectionchange` task. The `beforeinput` interception and the keymap both run
synchronously and read `view.state.selection`, so a keystroke arriving before that task
edited at the PREVIOUS insertion point: clicking into paragraph 3 and typing put the
character into paragraph 1. ProseMirror's own `keydown` calls
`domObserver.forceFlush()`, but that only runs an ALREADY-scheduled flush, so it was a
no-op here and `End`, `Home`, `Mod-A` and the arrows raced identically — `End` + Enter
split the wrong paragraph.

Fix: `adoptDomSelection` maps the live DOM selection through the public
`view.posAtDOM` and dispatches a selection-only transaction when it differs. Called from
`handleDOMEvents.keydown` (which runs before ProseMirror's own keydown, and therefore
before the keymap) and again at the top of `beforeinput`. Scoped to the visible
projection: in the clipped input host the semantic layer owns selection.

### 2. A paragraph created by Enter was immediately read-only

`packages/engine-core/src/package/docx/read.ts` — `assessBodyEditability`

A block minted by a committed `DocOp` has no entry in `preservation.blockRanges`, so it
was classified `no-source-range` and locked. Consequences, both measured:

- the very next keystroke after Enter was rejected, and the reproject that followed
  destroyed the new paragraph and dropped the typed characters into its neighbour;
- `structuralMutationAllowed` fell to false for the WHOLE document, so no further split
  or join worked either — one Enter permanently disabled paragraph structure editing.

The classification was wrong: such a block owns no original bytes, and the serializer
already regenerates it from the model inside the block region (`regenerateBlockRegion`),
which is the same path that had just emitted it. The preservation reader captures a range
for every block it reads and fails closed when the span scan and the parsed tree
disagree, so nothing that came from the FILE reaches the assessment rangeless.

Fix: a block with no range at all is engine-created and therefore patchable, and it
contributes no range so it cannot open a contiguity gap. The one rangeless block that is
NOT engine-created — the synthetic paragraph the reader adds for a body with no blocks —
stays read-only, because a regenerated region has to be anchored to at least one captured
range and that document has none. A range that exists but names another part keeps the
old `no-source-range` classification.

## Underline and the run-property projection (tasks 6.1/6.2, closing 2.3)

`Mod-U` could not be bound while the projection had no underline mark, and
`runIsProjectable` refused every run carrying one — which also locked whole paragraphs
read-only. Adding a boolean mark would have been wrong in a way the codebase had already
reasoned about: `runEditCommand` refused the toolbar's underline command outright because
`w:u` carries a variant, so a boolean could only re-emit `w:val="single"` and would
silently downgrade a double underline on save.

So the property is modeled properly instead. `RunProps.underline` is now
`{ val: UnderlineVariant; color?: string }` over the ECMA-376 `ST_Underline` enumeration:
parsed from `w:u` (bare `w:u` means `single`, `val="none"` is an authored OFF), validated
in the DocOp schema, carried through the ProseMirror mark as attrs, and re-emitted with
its authored variant and colour. The public `getSelectionFormatting().underline` stays a
boolean, so no public API moved.

With the variant on the mark, the keymap and the toolbar can finally give the same
answer: `underline` joined `TOGGLEABLE_MARKS` and the special-case refusal is gone.

### The bigger find: a real document rendered as plain text

Driving the underline fixture in Chrome showed ten authored `w:u` variants and **zero**
underlines on screen. Every run parsed from a real document carries a byte-exact `w:rPr`
capsule, and `runToText` returned early for capsule runs, projecting only the opaque
`rawRunProps` mark — which renders an inert `<span>`. Bold and italic were equally
invisible. The visible checkpoint was showing every formatted document unformatted.

The modeled marks cannot simply be projected alongside the capsule: they `exclude` it,
deliberately, so that toggling one drops the capsule and materializes the user's edit. So
the capsule mark now carries DISPLAY-ONLY attrs (`bold`, `italic`, `u`) derived from the
canonical run's already-validated props, and renders them as an inline style. The capsule
keeps serialization authority — a text edit still re-emits its exact bytes, so `double`
stays `double` — while the run finally looks like what it is.

Fixture: `examples/vite/public/underline-variants.docx`, regenerated by
`node scripts/make-underline-fixture.mjs`. Verified in Chrome at
`?browserFirst=1&fixture=underline-variants.docx`: solid, double, dotted, dashed and wavy
decorations plus red and blue underline colours, and editing the `double` line keeps it
double.

## Open findings for the user (task 2.6)

1. **Undo is per character.** Typing five characters takes five `Mod-Z` presses. Design
   D10 permits this explicitly ("consecutive ordinary typing transactions may remain
   separate entries"), and the gate asserts it rather than assuming otherwise, but it is
   not what Word does and it is the most likely thing to feel wrong.
2. **Only bold, italic and underline are projected.** The rest of the D8 run boundary —
   font family, size, colour, strike, highlight, caps, spacing, kerning — is preserved in
   the capsule and re-emitted correctly, but is neither displayed nor toggleable. The
   toolbar's other controls do nothing on this surface for that reason.
3. **CSS collapses the variants.** `text-decoration-style` has four values where
   `ST_Underline` has eighteen, so `thick`, `dashLongHeavy` and friends paint as their
   nearest CSS style. The authored value is what round-trips; only the picture is
   approximate, and the real renderer (task 7.2) is where that gets fixed.
4. **No pagination.** One page-like sheet, deliberately (D11). Long content overflows it.

The earlier claim that "the toolbar is not wired to this surface" was wrong — the B, I and
U buttons drive the real commands and reflect live selection state.

## Verification

- `bunx playwright test --config browser-first.config.ts`: 8 passed (~50s).
- `bun test packages/engine-binding`: 188 passed in under two seconds — the underline
  model, projection, reverse mapping, capsule display, and forged-attribute fallback are
  all covered by fast unit tests rather than browser runs.
- `bun run typecheck`: passed.
- `bun test`: 2244 pass, 7 fail, 2 errors — the same failures as `baseline.md` (the two
  gates were re-run against a stash of this change and fail identically without it).
- `bun run api:check` and `bun run check:parity`: fail, and fail identically with this
  change stashed — pre-existing, unrelated to this work.
- `bun run i18n:validate`: passed.
- `openspec validate typed-ooxml-paragraph-editor --strict`: valid.
- `e2e/react-one-surface.interaction.spec.ts` and `react-real-adapter.smoke.spec.ts`:
  13 passed, so the editability-policy change did not disturb the painted surface.
