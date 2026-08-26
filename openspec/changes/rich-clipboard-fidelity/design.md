# Design — rich-clipboard-fidelity

## Context

Today both clipboard directions are plain text by explicit doctrine
(`packages/core/src/editor/surface-input.ts` header comment). Copy/cut write
`text/plain` only; paste routes through `plainTextFromTransfer` and
`insertPlainText`. There is no range-to-fragment extractor (the only range
readers return strings), no op that inserts arbitrary block subtrees
(`insertDrawing` accepts a single drawing subtree, which is the precedent for
`insertFragment`), and no HTML serializer. The north star for this change:
select-all on the demo `examples/vite/public/sample.docx`, copy, paste into a
blank document, and get essentially the same body back. Headers and footers
are out of scope. The same payload must keep formatting when pasted into Word
or Google Docs, and HTML copied from those editors must keep formatting when
pasted here.

## Goals / Non-Goals

Goals: full-fidelity self round-trip for body content, including notes;
formatted HTML out for external editors; formatted HTML in from external
editors; the existing plain lane preserved and forceable.

Non-Goals, each a knowing divergence from Word listed here so it is a
decision and not an accident:

- Headers/footers and `w:sectPr` on the clipboard. Word preserves section
  breaks inside a copied range; this change drops them, so a landscape or
  multi-column section pastes as flowing content and page-relative anchors
  resolve against the target's pages. The docs matrix names this limit.
- Comments. Word transfers comments whose range is covered; this change
  strips them.
- Structural `w:ins` wrapping of rich paste in suggesting mode; rich paste
  degrades to the tracked plain lane there.
- A rectangular cell-grid copy model. A cell-rectangle selection copies as
  grid text and flattened HTML; Word copies it as a table and fills cells on
  paste into a table. Follow-up work.
- The drop lane (`insertFromDrop`) and paste-as-quotation stay plain text.
- Embedded fonts and the font table (Word does not carry them on paste
  either). Math, ruby, and East Asian layout travel lossless in the fragment
  lane but are omitted from the interop HTML lanes.
- Hyperlinks and REF-style fields whose bookmark target is not copied stay
  dangling, which matches Word.
- Native OS clipboard flavours beyond `text/plain` and `text/html`.

## Decisions

### D1 — The fragment is a miniature WordprocessingML package in `text/html`

Copy serializes the range into a small, valid OPC zip (document part with the
covered blocks, plus dependent parts), compressed with fflate (already a
dependency). Its base64 rides in the `text/html` payload as an attribute on
one wrapper element (`<div data-docx-fragment="...">`). This survives
cross-tab, cross-window, and remote-desktop clipboards, and every external
receiver simply ignores the attribute and reads the visible HTML.

Rejected: custom web clipboard formats (Chromium-only), and an in-memory
fragment cache keyed by a marker (fails cross-tab). A native custom flavour
can be added later without changing this shape.

### D2 — Reads reuse the bounded file-open trust boundary

A pasted fragment is attacker-controlled. Paste decodes the attribute and
reads the bytes through the existing bounded OPC/XML reader
(`readOoxmlPackage`), inheriting its zip ratio/size caps, path checks, and
demote-to-generic behavior, plus a dedicated decoded-size cap for the
clipboard lane. External `text/html` parses via `DOMParser` into an inert
document inside the editor lane only: size cap before parse, node-count and
depth caps during the walk, parsed nodes never attached anywhere, projection
into tree builders only. Every href passes `sanitizeHref`; `<img>` is
accepted for `data:` URIs only; external `src` is dropped (no zero-click
fetch). The HTML-sink lint bans insertion sinks, not inert parsing; the
module header documents this posture.

### D3 — Fragment contents, exclusions, and materialized defaults

In: covered block subtrees with edge paragraphs trimmed to the range, runs
split at the offsets, and a per-edge-paragraph bit recording whether the
range covered the paragraph mark; the used style closure
(`basedOn`/`link`/`next` chains) computed over every travelling story,
including footnote and endnote bodies; used numbering (`w:num` plus
`w:abstractNum`) resolved after the style cascade, so numbering carried by a
style is not missed; media parts for covered drawings and their rels;
hyperlink rels; footnote and endnote bodies referenced inside the range;
block SDTs (including a TOC) as lossless subtrees; bookmarks fully inside the
range (unbalanced markers dropped). Compound constructs stay balanced: a
complex field not fully covered contributes its cached result runs only; a
partially covered inline SDT unwraps to its covered runs; revision wrappers
travel lossless with attribution.

Out, stripped at extract: header/footer parts, every `w:sectPr`
(paragraph-mark and body-final — the target keeps its page setup), comments
and their markers, settings, docDefaults, and theme.

Theme parts are stripped with their references literalized at extraction; the
source docDefaults ride INSIDE the fragment styles part as the materialization
source, and the merge stamps the source-vs-target default delta as direct
formatting wherever the pasted content does not carry the value explicitly. Without this, every unstyled paragraph would
silently re-resolve against the target's defaults (for example Arial 11pt
body text flipping to Calibri), which the authored-markup oracle cannot see.
This mirrors Word's keep-source-formatting behavior, which literalizes
theme- and default-derived values on cross-document paste. Implicit
references to the default paragraph style cannot be id-rewritten, so
materialization is the mechanism that keeps unstyled content stable.

### D4 — Merge remaps identifiers instead of trusting them

Style ids: reuse the target's id when the definition fingerprint matches,
else import under a fresh id and rewrite references in fragment content and
in other imported definitions; a `w:name` collision with a different target
definition gets a derived unique name (Word resolves name collisions
destination-wins; the divergence is documented). Numbering: always remap
`numId`/`abstractNumId` to fresh target ids and dedupe identical definitions
by a fingerprint that includes `w:lvlOverride`/`w:startOverride`.
Relationship ids: always fresh. Media: dedupe by content hash and rename
collision-free (precedent: `store/package/drawing-package-edit.ts`). Every
document-unique id namespace is freshened — bookmark ids, drawing `docPr`
ids, SDT ids, revision ids — and bookmark name collisions resolve in favor
of the pasted bookmark, as in Word. A drawing referencing non-media parts
the fragment does not carry (charts, embedded objects) is omitted instead of
shipping a dangling rel — a visible placeholder would fake content and pollute
the fidelity oracles. Notes: when the fragment
carries footnote or endnote bodies, the merge provisions the target parts if
absent (separator and continuation-separator notes, content types, rels) and
remaps note ids so references renumber in the target sequence.

### D5 — One new op: `insertFragment`, promoted to a package undo unit

Lowering to the existing op vocabulary cannot express a `w:tbl`, block SDT,
or drawing subtree mid-story, so the store gains
`insertFragment { paragraphId, offset, blocks }` applied inside one
`transact`. The op payload carries blocks only, staying JSON-safe and
transportable like every `TreeDocOp`. The resource merge applies through the
package-edit path (`ctx.applyPackage`) inside the same transaction, and the
commit is promoted with `promoteStoryTransactionToPackageUnit` — the exact
pattern `tree-package-images.ts` uses — so undo reverts the tree and the
imported styles, numbering, media, rels, and note parts together.

Word merge semantics at apply: a merged edge paragraph takes the properties
of the paragraph mark that ends it — the fragment's first-paragraph mark for
the leading merge, the host's original mark for the trailing merge; a
single-paragraph fragment without a covered mark leaves host paragraph
properties untouched. Whole tables and block SDTs land as siblings. Nodes
get fresh ids at apply. Validation refuses with typed rejections
(`fragment-too-deep`, `fragment-invalid-block`, `fragment-resource-budget`,
`not-a-paragraph`); one bad op vetoes the whole transaction, and the paste
router degrades a refused fragment to the next flavour instead of leaving a
no-op paste. Suggesting mode refuses `insertFragment` and the router
degrades to the plain lane, which already emits `w:ins`.

### D6 — Outbound HTML is tree-driven with resolved inline CSS

Structure comes from the tree (headings from the resolved style chain, real
`<ol>/<ul>/<li>` lists, `<table>/<tr>/<td>`, `<a href>`); formatting comes
from resolved values (`ResolvedRunStyle` and resolved paragraph properties)
as inline CSS, so receivers need no stylesheet. Images become `data:` URIs
under a per-image and total budget; over budget they are omitted. Constructs
without an HTML mapping are omitted from the interop HTML and travel only in
the fragment lane. The writer is a string builder with escaping on every
attribute and text value; it touches no DOM.

### D7 — Paste precedence, the plain escape hatch, and the command lane

Router order: internal fragment, then external `text/html`, then
`text/plain`. Degrade is continuous: decode failure, read failure, and
apply-refusal each fall to the next flavour. Cmd+Shift+V forces the plain
lane via a transient force-plain flag that the paste event handler reads —
the keydown handler neither prevents default nor touches the clipboard,
because the payload only exists on the `paste` event (and browsers deliver
plain-only payloads for that chord in some engines, which the flag also
covers). Outside the body story and in suggesting mode the router degrades
to plain.

The command lane widens: `paste` accepts `{ text, html? }` and routes
through the same precedence; `pasteWithoutFormatting { text }` is the plain
twin. This reverses the documented "no rich lane and no pastePlain twin"
doctrine in `contracts/editor.ts`, so that comment is rewritten alongside the
`surface-input.ts` header, the `clipboard-plain-text.ts` header, and the
drop-lane comment — the doctrine changes in every place it is stated. The
widening is additive public API: the contracts and store snapshots are
re-extracted (`bun run api:extract` after a stable rebuild).

### D8 — Write plumbing per lane

DOM `copy`/`cut` events set both flavours synchronously with `setData` — no
permissions, all browsers. The command lane gains `writeClipboardRich(text,
html)` beside `writeClipboardText` using `ClipboardItem`, same never-throws
fire-and-forget contract, `writeText` fallback where `ClipboardItem` is
missing; both strings are built before the async call so Safari's gesture
window holds. Oversized selections degrade in tiers: drop media from the
fragment, then drop the fragment attribute entirely; the interop HTML ships
whenever the range extracts at all. A cell-rectangle selection copies as grid text plus flattened HTML,
no fragment. A copy bench lands next to the existing paste bench.

Adapter interaction: the React and Vue Content components intercept paste
when the transfer carries an image file. Real word-processor payloads carry
`text/html` and an image file together, so the interception stands down when
the payload carries `text/html` or the event is already default-prevented;
otherwise the same image would insert twice. Context-menu paste reads rich
flavours via the async clipboard where permitted; some engines strip
attributes from async-read HTML, so the read degrades to plain text and a
test pins that path.

### D9 — Acceptance oracle

Engine-level, no real clipboard: open the sample document, extract the full
body, merge and `insertFragment` into a blank document, then compare
`canonicalOoxmlFingerprint` of the body, footnote, and endnote stories under
a defined normalization: strip every `w:sectPr`,
`w14:paraId`/`w14:textId`/`w:rsid*`, and comment markers; ignore
header/footer parts and the comments part; compare explicit style references
by resolved-definition fingerprint and `numId` values through the remap;
compare relationship ids by resolved target (URL or media hash); compare
note references through the note-id remap; compare bookmarks by name;
exclude theme, settings, and docDefaults from part comparison. Because the
markup compare is blind to default-resolution drift, the oracle additionally
compares resolved run and paragraph appearance for a sampled paragraph set.
A Playwright e2e drives the real keyboard path (select-all, copy, new
document, paste) as a smoke over the same oracle.

## Module plan

Store lane (DOM-free, imports nothing): `store/package/clipboard-fragment-
extract.ts` and `store/package/clipboard-fragment-merge.ts` — both pure over
an `OoxmlPart`/package plus a caller-supplied coverage description;
`store/store/tree-op-fragment.ts` (op type added in `tree-op-types.ts`).

Editor lane: the coverage description (ordered ids, covered-block set, edge
offsets, mark-coverage bits) is computed by a helper factored out of
`planRangeDeletion` in `editor/surface-selection-ops.ts` — the helper stays
in the editor lane because it reads the layout, and only data crosses the
lane boundary into the store extractor, never an import. New:
`editor/clipboard-fragment-codec.ts`, `editor/clipboard-html-write.ts`,
`editor/clipboard-html-read.ts`, `editor/clipboard-paste-router.ts`. Edited:
`editor/surface-input.ts`, `editor/clipboard-write.ts`,
`editor/docx-editor-exec.ts`, `editor/docx-editor-support.ts`,
`editor/docx-editor-derive.ts`, `editor/paginated-surface.ts`, and
`contracts/editor.ts` (command widening; the file sits near its line cap, so
keep the added contract docs terse or extract first).

Adapters: `packages/react/src/editor/DocxEditorContent.tsx` and the Vue twin
(image-interception stand-down), context-menu paste parts in both.

## Risks / Trade-offs

- **Payload size.** Base64 zips with media are large and some OS clipboards
  truncate. Mitigated by media budgets and the tiered degrade, both pinned in
  tests.
- **Copy latency.** Serialization and default-materialization run
  synchronously in the copy handler. Mitigated by an O(selection) build, the
  copy bench, and the degrade tiers.
- **Deliberate doctrine reversal.** The plain-text-only comments (surface
  input, plain-text module, drop lane, editor contract) and the "plain wins"
  test are explicit decisions; this change rewrites all of them explicitly
  rather than working around any.
- **Materialization scope.** Deciding which resolved values to literalize
  (fonts, size, color, spacing) without bloating every run is the subtle
  part; the sampled resolved-appearance oracle is the guard.
- **Remap fidelity.** Numbering restarts, `w:lvlOverride`, style `link`
  chains, and in-definition references are the fiddly closure cases; covered
  by targeted fixtures from the sample document.
- **Browser variance.** `ClipboardItem` support and async-read HTML
  stripping differ; the DOM event lane covers every keyboard path, and the
  async lane has a pinned degrade test.
- **Suggesting mode.** Rich paste degrades to plain there; documented
  limitation with a follow-up change for structural `w:ins` wrapping.
