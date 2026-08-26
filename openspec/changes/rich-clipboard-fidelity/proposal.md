## Why

The clipboard is plain-text only in both directions. Copy and cut write one
`text/plain` flavour, and paste reduces any `text/html` payload to its visible
text. Select-all on a document followed by paste into a blank document loses
every style, list, table, hyperlink, and image. Word and Google Docs preserve
formatting across copy/paste, inside the editor and across applications, and
the editor must match that behavior. The docs feature matrix already claims
rich clipboard support, so the gap is also a published overclaim.

## What Changes

**Fragment lane (self round-trip)**

- Copy serializes the selected range into a minimal, valid WordprocessingML
  package: covered blocks plus the dependency closure (used styles, used
  numbering, media, hyperlink rels, referenced footnote/endnote bodies).
  Headers, footers, `w:sectPr`, comments, settings, docDefaults, and theme are
  stripped; default- and theme-derived formatting is materialized as direct
  formatting so appearance survives a target with different defaults.
  Partially covered fields, inline content controls, and revision wrappers
  stay balanced.
- The fragment package rides base64-encoded inside the `text/html` payload on
  a single wrapper element, so it survives cross-tab and cross-window paste
  and degrades to plain HTML everywhere else.
- A new `insertFragment` tree op inserts fragment blocks atomically, with
  Word's paragraph-mark merge semantics at the paste position, fresh node
  ids, and typed refusals; the commit is promoted to a package undo unit so
  undo also reverts imported resources. Resource merge dedupes styles by
  definition fingerprint, remaps numbering, relationship, bookmark, and note
  ids, dedupes media by content hash, and provisions footnote/endnote parts
  in targets that lack them.

**HTML interop lanes (external applications)**

- Copy also writes standalone interop HTML: tree-driven structure with
  resolved inline CSS (headings, real `<ol>/<ul>` lists, tables, hyperlinks,
  capped `data:` images) so external editors keep formatting.
- Paste parses external `text/html` through a bounded, inert projection into
  tree ops: size/depth/node caps, `sanitizeHref` on every href, `data:`-only
  images, no zero-click fetch.

**Routing and plumbing**

- Paste precedence becomes: internal fragment, then external `text/html`,
  then `text/plain`, with continuous degrade on decode, read, or apply
  failure. A paste-without-formatting command (Cmd+Shift+V) forces the plain
  lane. Suggesting mode and non-body stories degrade rich paste to the
  existing plain lane. Paste stays one commit. The `paste` editor command
  widens additively to `{ text, html? }` and gains a `pasteWithoutFormatting`
  twin; the contract's "no rich lane" doctrine comment is rewritten.
- Copy/cut write multiple flavours synchronously on the DOM event lane; the
  command lane gains a rich clipboard writer with the same never-throws
  contract. Oversized payloads degrade in tiers: drop media, then drop the
  fragment, keep interop HTML.
- `docs/site/data/word-features.ts` is corrected to the shipped clipboard
  state until this change lands, then updated with it.

## Capabilities

### New Capabilities

- `clipboard-fragment-extract`: semantic range to minimal WordprocessingML
  fragment package with dependency closure and defined exclusions.
- `clipboard-fragment-insert`: `insertFragment` op and resource merge/remap
  into the target package, with typed refusals.
- `clipboard-rich-copy`: copy/cut write plain text, interop HTML, and the
  embedded fragment on both the DOM and command lanes.
- `clipboard-html-interop`: interop HTML serialization out and bounded HTML
  projection in.
- `clipboard-paste-routing`: flavour precedence, paste-without-formatting,
  suggesting-mode degrade, plain lane preserved.

### Modified Capabilities

None.

## Impact

- `packages/core` — store lane: fragment extract/merge modules and the
  `insertFragment` op; editor lane: clipboard codec, HTML write/read, paste
  router, updated copy/cut/paste handlers and command lane.
- `packages/react`, `packages/vue` — context-menu paste reads rich flavours
  where the host permits, with `readText` fallback.
- `packages/i18n` — strings for the paste-without-formatting control.
- `docs/site/data/word-features.ts`, docs site clipboard page.
- Tests: store fragment round-trip oracle on the demo sample document, editor
  flavour/router suites, external-HTML fixtures, e2e select-all round trip,
  copy latency bench next to the paste bench.
