## 1. Fragment extract (store lane)

- [x] 1.1 Factor the full-coverage predicate out of `planRangeDeletion` in
      `packages/core/src/editor/surface-selection-ops.ts` into an editor-lane
      helper that emits a plain coverage description (ordered covered blocks,
      fully covered tables/SDTs, edge offsets, per-edge paragraph-mark bits).
      Only this data crosses into the store lane; the store never imports
      from the editor lane (`core-lane-graph.ts`).
- [x] 1.2 Build `packages/core/src/store/package/clipboard-fragment-extract.ts`
      as a pure function over the package plus the coverage description:
      range walk, edge-paragraph trim, run split at offsets, whole
      tables/SDTs, row-aligned rows with `w:vMerge` restart promotion,
      flatten fallback.
- [x] 1.3 Balance rules: partially covered complex fields contribute cached
      result runs only; fully covered fields (incl. `w:fldSimple`) travel
      intact; partially covered inline SDTs unwrap; revision wrappers travel
      lossless and survive edge splits.
- [x] 1.4 Dependency closure over every travelling story (body + note
      bodies): used styles (`basedOn`/`link`/`next`), used numbering resolved
      after the style cascade, media parts and rels for covered drawings,
      hyperlink rels, referenced footnote/endnote bodies, balanced bookmarks.
- [x] 1.5 Exclusion stripping (headers/footers, every `w:sectPr`, comments
      and markers, settings, docDefaults, theme) plus materialization of
      source-resolved defaults as direct formatting where the fragment does
      not carry the value explicitly.
- [x] 1.6 Serialize the fragment as a valid OPC zip via the existing part
      serializer; prove it re-reads through `readOoxmlPackage`.
- [x] 1.7 Extract-only test harness on `examples/vite/public/sample.docx`:
      closure completeness incl. note-body styles, exclusion absence, trim
      and mark-bit correctness, field/SDT balance.

## 2. Fragment insert (store lane)

- [x] 2.1 Add `insertFragment { paragraphId, offset, blocks }` to
      `packages/core/src/store/store/tree-op-types.ts` (JSON-safe, blocks
      only); apply/validate in a new `tree-op-fragment.ts` with Word
      edge-mark semantics (merged paragraph takes the mark that ends it),
      fresh node ids, typed refusals, recursion and resource budgets.
- [x] 2.2 Build `packages/core/src/store/package/clipboard-fragment-merge.ts`
      applied via `ctx.applyPackage` in the same transaction and promoted
      with `promoteStoryTransactionToPackageUnit` (pattern:
      `tree-package-images.ts`), so undo reverts tree and resources together.
- [x] 2.3 Remaps: style fingerprint reuse-or-import with derived unique
      `w:name` on collision and reference rewrites inside imported
      definitions; numbering remap with override-inclusive fingerprints;
      fresh rIds; media dedupe by content hash; freshen bookmark/`docPr`/SDT/
      revision ids; pasted bookmark wins name collisions; placeholder degrade
      for drawings referencing uncarried non-media parts.
- [x] 2.4 Note transfer: provision footnotes/endnotes parts when absent
      (separator + continuation-separator notes, content types, rels); remap
      note ids so references renumber in the target sequence.
- [x] 2.5 Define the normalization oracle (strip `w:sectPr`, paragraph and
      revision ids, comment markers; fingerprint-based style/numbering/rel
      comparison; note-id remap comparison; sampled resolved-appearance
      comparison) as a test utility.
- [x] 2.6 North-star API test: extract the sample body, insert into a blank
      document, body + footnote + endnote fingerprints match under the
      oracle and the resolved-appearance sample matches. Undo test: resources
      revert with the tree. Milestone: fidelity proven without a clipboard.

## 3. Rich copy (editor lane)

- [x] 3.1 `editor/clipboard-fragment-codec.ts`: zip bytes to base64 attribute
      and back, bounded attribute scan, decoded-size cap.
- [x] 3.2 `editor/clipboard-html-write.ts`: tree-driven interop HTML with
      resolved inline CSS; sanitized hrefs; budgeted `data:` images; unmapped
      constructs omitted; string builder with escaping, no DOM sinks.
- [x] 3.3 Multi-flavour `setData` in `createClipboardHandlers`
      (`editor/surface-input.ts`); cell-rectangle copy stays grid text +
      flattened HTML with no fragment; rewrite the plain-text doctrine
      comments in `surface-input.ts`, `clipboard-plain-text.ts`, and the
      drop-lane comment.
- [x] 3.4 `writeClipboardRich` in `editor/clipboard-write.ts` (`ClipboardItem`,
      never-throws, `writeText` fallback, payloads built before the async
      call); wire the exec-lane copy/cut in `editor/docx-editor-exec.ts`.
- [x] 3.5 Degrade tiers (drop media, drop fragment) with pinned budget tests;
      copy latency bench next to the `huge-paste-50k` gate.

## 4. Paste routing (editor lane)

- [x] 4.1 `editor/clipboard-paste-router.ts`: fragment > external HTML >
      plain; degrade on decode failure, read failure, AND apply refusal;
      suggesting-mode and non-body-story degrade to the plain lane; drop lane
      untouched.
- [x] 4.2 Fragment paste as one commit on `paginated-surface.ts`:
      deleteSelectionPlan ops plus `insertFragment`, caret after the pasted
      content, undo/redo.
- [x] 4.3 Widen the `paste` command to `{ text, html? }` and add
      `pasteWithoutFormatting { text }` in `contracts/editor.ts` (rewrite the
      "no rich lane" doctrine there; mind the file's line-cap headroom),
      `docx-editor-exec.ts`, `docx-editor-support.ts`,
      `docx-editor-derive.ts`.
- [x] 4.4 Cmd+Shift+V via a transient force-plain flag read by the paste
      event handler; the keydown handler neither prevents default nor reads
      the clipboard.
- [x] 4.5 Renegotiate pinned tests: re-scope "plain wins"
      (`clipboard-plain-text.test.ts`) to the plain lane, add router
      precedence and refusal-degrade tests.
- [x] 4.6 Playwright e2e north star: open sample, Cmd+A, Cmd+C, new blank
      document (demo New action), Cmd+V, oracle comparison.

## 5. External HTML read (editor lane)

- [x] 5.1 `editor/clipboard-html-read.ts`: `DOMParser` into an inert document,
      size/depth/node caps, projection into tree ops only; document the
      parse-not-sink posture in the module header.
- [x] 5.2 CSS/tag mapping table: alignment, line height, margins/indents,
      heading detection, semantic list markup AND Word's `mso-list`
      convention to fresh numbering, cell CSS to cell properties, run CSS to
      run properties.
- [x] 5.3 Href sanitizer on every anchor; `data:`-only images; drop external
      sources with no fetch; hostile-payload tests (script, event handlers,
      `javascript:` hrefs, external images).
- [x] 5.4 Fixture tests with desktop-Word-shaped (`mso-list`) and
      web-editor-shaped HTML payloads in
      `packages/core/src/editor/__tests__/`.

## 6. Adapters, docs, release

- [x] 6.1 Image-paste interception stand-down in
      `packages/react/src/editor/DocxEditorContent.tsx` and the Vue twin:
      skip when the transfer carries `text/html` or the event is
      default-prevented, so pasted content never inserts its image twice.
- [x] 6.2 Context-menu paste in `packages/react` and `packages/vue`: read
      rich flavours via the async clipboard where permitted, exec
      `paste { text, html }`; pinned degrade test for engines that strip
      async-read HTML; add a paste-without-formatting row.
- [x] 6.3 i18n keys for the paste-without-formatting row in
      `packages/i18n/en.json` plus `bun run i18n:fix`.
- [x] 6.4 Correct `docs/site/data/word-features.ts` `collab.clipboard` and
      name the section/comment limits; update the docs site clipboard page.
- [x] 6.5 `bun run api:extract` after a stable rebuild (rebuild 3-4x first)
      for the widened command contract and the new op; commit snapshots.
- [x] 6.6 Changeset (minor: additive public commands and clipboard behavior).
- [x] 6.7 Full gates: `bun run typecheck`, `bun run lint`, `bun run test`,
      `bun run check:parity`, `bun run api:check`, `bun run i18n:validate`,
      `openspec validate rich-clipboard-fidelity --strict`.
