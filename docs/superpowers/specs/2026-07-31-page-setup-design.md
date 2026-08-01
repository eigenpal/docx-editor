# Page setup: margins, size, orientation — write path, rulers, dialog

Date: 2026-07-31. Branch: `docx-editor-v2`.

## Goal

The v2 engine reads section geometry (`readSectionProperties` →
`geometryOfSection` → layout) but has no write path. This change adds one, and
wires it into chrome: draggable ruler margins and a Page Setup dialog
(File > Page setup in the Google-Docs reference screenshots). Opening files
with landscape pages already paginates correctly (layout uses `pgSz@w/@h`
directly); the read-side gap is only that `landscape` is derived solely from
`w:orient`, so a file storing swapped dimensions without the attribute reports
portrait.

## Decisions

1. **One new `TreeDocOp`: `setSectionProperties`.** Fields, all optional (at
   least one required): `pageWidthTwips`, `pageHeightTwips`, `orientation`,
   `marginTopTwips/RightTwips/BottomTwips/LeftTwips`. It applies to EVERY
   `w:sectPr` in the part — mid-body sections included — because the dialog
   and the ruler mean "this document" (Word's "Apply to: Whole document").
   Updating only the body-level section left a multi-section file saying
   "portrait, …, landscape", which Word renders as mixed orientation (found
   live on the demo document, which carries five sections). A document with
   no section at all gets a body-level one minted as the body's last child.
   No paragraph id, unlike every existing op. Validation mirrors the read-side
   clamps (`section-properties.ts`): page dims integer 1..63360, margins
   integer 0..31680 (the write path refuses negative margins even though the
   reader tolerates them), orientation a closed enum, and the merged result
   must keep a positive content area (the read side falls back to default
   geometry when margins swallow the page; refusing the write is honest,
   falling back silently is not). Apply is surgical: merge only the attributes
   the op carries into `pgSz`/`pgMar`, preserving `header`/`footer`/`gutter`
   and unknown attributes and every sibling child (`cols`, `titlePg`,
   `headerReference`, ...). `orient="landscape"` is written when landscape;
   the attribute is removed for portrait (Word's own shape). Impact:
   `flow-structural` with empty dirty set — the layout session context string
   already includes geometry, so checkpoints and caches invalidate; undo
   snapshots the whole part, so history is free.

2. **Command layer owns orientation normalization.** `exec({type:
   'setPageSetup'})` (already declared in `EditorCommands`) resolves the final
   dimensions: when orientation is given, width/height (given or current) are
   swapped if needed so landscape stores width > height. The op itself writes
   literal values only.

3. **`landscape` read becomes render-truthful**: `orient === 'landscape' ||
   width > height`.

4. **Page setup joins the snapshot.** `EditorSnapshot.pageSetup?` (additive,
   the `getPageSetup()` shape, named `PageSetup` in the contract) with
   value-equality reference reuse like `formatting`/`page`. Without it a
   second margin change moves no snapshot field and the rulers would never
   re-render — the snapshot's identity is the one change signal for document
   state.

5. **React: everything through hooks.** New public `usePageSetup()` →
   `{ pageSetup, isEnabled, apply(update) }` over `useEditorState` +
   `editor.exec`. `DocxEditor.HorizontalRuler`/`VerticalRuler` become
   editable: margin drags preview locally (the underlying ruler components
   gain an `onMarginDragEnd` callback) and commit ONCE on release — one undo
   entry per drag, no relayout storm. Editability follows
   `can({type:'setPageSetup'})` and `snapshot.editable`.

6. **`DocxEditor.PageSetupDialog`** — controlled (`open`/`onClose`), size
   presets (Letter/A4/Legal/A3/A5/B5/Executive/Custom; portrait-normalized
   matching with ±20 twip tolerance so orientation never breaks preset
   detection — recovered rule from the v1 dialog at `c815d02f3`), orientation
   select, margin inputs in inches. i18n keys `dialogs.pageSetup.*` already
   exist. `--doc-*` tokens, caret-preserving mousedown. The vite demo gets a
   Page setup control opening it.

7. **No new chrome slot.** Page setup is dialog/ruler chrome, not a toolbar
   toggle; the slot registry stays untouched. Vue twin is deferred, matching
   the adapter-parity lane.

## Per-section lane (added in the same PR)

Initially deferred, then pulled in: `readDocumentSections` maps every section
to the blocks it governs; `layoutSemanticDocument` takes a `sections` input
and paginates each against its own geometry (next-page boundaries start a new
sheet; `continuous` with an unchanged geometry shares one; sheets of mixed
sizes stack cumulatively and centre against the widest). Reads
(`getPageSetup`, `snapshot().pageSetup`, rulers) follow the CARET's section.
Writes take Word's "Apply to": `scope: 'section'` anchors the op to the
selection's governing section; ruler drags are always this-section. An
orientation change without explicit dimensions swaps each written section's
own dimensions. `insertBreak` kind `section` splits at the caret and mints a
`w:pPr/w:sectPr` cloning the governing setup. The apply is ONE
structural-sharing tree rebuild regardless of section count (a per-section
rebuild was quadratic in a file-controlled number), and validation checks the
planned result per targeted section.

## Out of scope

Even/odd-page break parity (those break like nextPage), per-section columns
and header/footer re-breaking at section width (furniture is positioned per
page but broken at the body width), paper-size `w:code` maintenance
beyond dropping it when dimensions change, header/footer distance UI, gutter
UI, indent drag on rulers (needs the stored-selection indent lane).

## Tests

Op validate/apply (create-vs-merge, preservation, hostile values, undo);
orientation read; exec normalization + snapshot stability; React ruler/dialog
smoke tests.
