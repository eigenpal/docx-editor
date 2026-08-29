# Roadmap

docx-editor aims to be the open-source `.docx` editor you can trust with real Word
documents: what you see matches what Microsoft Word shows, and what you save is the
document you opened plus exactly the edits you made. Everything else — the React and
Vue adapters, collaboration, the automation API — builds on that foundation.

The **[public roadmap board](https://github.com/orgs/eigenpal/projects/2)** is a live
view of this repository's issues. Every issue carries one `area:*` and one
`priority:*` label, and a workflow mirrors those labels into the board's **Area** and
**Priority** fields, so the board always reflects the issue tracker.

## Areas

### Word fidelity

Rendering, layout, and round-trip fidelity against Microsoft Word. This is the
largest area and the core promise of the project: font metrics and substitution,
table layout, footnotes and endnotes, anchored drawings and text wrap, list
numbering, and field results such as `REF`, `PAGEREF`, and `AUTONUM`. A document
must paginate like Word, print like Word, and survive open → edit → save without
losing content the editor doesn't model.

### Performance

Speed and memory on real documents: typing latency, incremental layout, paste,
load, and save. The bar is set by large documents (hundreds of pages, large
tables, many images), where a keystroke must stay within a frame budget instead
of re-deriving whole-document state.

### Collaboration

Real-time multi-user editing, tracked changes, and comments. Work here covers
convergence under concurrent edits (two peers editing the same paragraph must
never diverge or duplicate text), suggesting mode writing every edit as a
tracked change, and the review UI for accepting and rejecting changes.

### Agent-ready

Headless and server-side automation through the `DocxEditor` object model in
`@docx-editor.dev/editor-api`: programs and agents that read, edit, and save
documents without a browser UI, or drive an editor already open in a page.

### UX

The editing experience around the document: toolbar and menu state, caret and
selection behavior, IME input, printing, touch input, and editor chrome. The
document canvas belongs to Word fidelity; the controls around it belong here.

### Developer experience

Everything integrators touch: packaging and bundler compatibility, React and Vue
adapter parity, the public API surface, documentation, and the CI gates that
keep them honest.

## Non-goals

> **Status: proposed.** These candidates are pending maintainer approval and may
> change.

- **Legacy binary `.doc` files.** The engine reads and writes OOXML (`.docx`) only.
- **Import from or export to other formats.** No HTML, Markdown, or PDF
  conversion pipeline; the round-trip guarantee only makes sense inside OOXML.
- **A generic rich-text editor.** The document model is WordprocessingML, not a
  neutral schema with DOCX export bolted on.
- **Matching Word Online quirks.** Where Word Online and desktop Word disagree,
  desktop Word is the oracle.
- **Server-rendered editing.** The editor requires the DOM; headless use goes
  through `@docx-editor.dev/editor-api`.

## Influencing the roadmap

Open a [GitHub issue](https://github.com/eigenpal/docx-editor/issues) with a
reproducible case, ideally with a `.docx` that shows the problem. Reactions are
weighed when priorities are set, so a 👍 on an existing issue is a vote. Maintainers
assign the `area:*` and `priority:*` labels; the board updates automatically.
