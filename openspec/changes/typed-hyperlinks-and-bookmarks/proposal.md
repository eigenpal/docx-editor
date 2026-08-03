## Why

`deferred-features.md` records hyperlinks as: parse `generic preserved after safe-target classification`; model `untyped relationship-backed content`; layout `deferred`; edit/activation `deferred with no zero-click fetch`. Its named future gate is "typed hyperlink nodes, sanitized URL commands, explicit user activation, layout, and paired acceptance".

Layout being deferred does not degrade gracefully here — it deletes visible words. `comprehensive-word-element-test.docx` section 9 holds five `w:hyperlink` elements: two external (`r:id` → `https://example.com`, `https://www.anthropic.com`) and three internal (`w:anchor` → the `section1`/`section6`/`section12` bookmarks). Because a `w:hyperlink` child is not a `run`, its runs never enter the token stream: paragraph 9.1 paints as "Visit  or ." instead of "Visit Example.com or Anthropic's website.", and 9.2 paints as "Jump to:  |  |". A reader sees sentences with holes where the links were, with no indication anything is missing.

The chrome already names the intent: `text.link` is in `ChromeSlotId` and the formatting group of `CHROME_GROUPS` with `state: { kind: 'command' }`, and is not in `SLOT_COMMANDS`, so it renders disabled. The store already places hyperlink and bookmark anchors correctly across paragraph splits (`tree-op-split-anchors.test.ts`), and `sanitizeHref`/`escapeXml` exist in `store/package/sinks.ts` — the trust-boundary plumbing this lane needs is in place; nothing consumes it yet.

## What Changes

**Typed hyperlink and bookmark nodes**

- Add `hyperlink` to the node-kind union in `packages/core/src/store/package/ooxml-tree.ts`, typing `CT_Hyperlink`: `@r:id`, `@w:anchor`, `@w:tooltip`, `@w:history`, `@w:docLocation`, `@w:tgtFrame`, with `run` children joining the paragraph's inline sequence.
- Type `w:bookmarkStart` (`@w:id`, `@w:name`) / `w:bookmarkEnd` (`@w:id`) as zero-length point anchors. Split/merge placement keeps the behavior already pinned by `tree-op-split-anchors.test.ts`.
- Resolve `@r:id` through the part's relationships. `TargetMode="External"` classifies the link as external; a missing or dangling relationship demotes the hyperlink to its runs (text is never lost twice).
- A `w:hyperlink` with attributes the model does not type, or nested content beyond runs and anchors (a `w:hyperlink` around a drawing, a field, nested markers), stays typed with `generic` children — preserved, painted as its runs where possible.

**Sanitization and save (design D14 / security contract)**

- The runtime projection of every target goes through `sanitizeHref`: allowlist `http(s)/mailto/tel/ftp`, everything else inert. The authored raw target is retained by the record layer and re-emitted on save via `escapeXml`. `javascript:`/`data:`/`vbscript:`/`file:` targets paint as links with no `href` and no activation.
- Opening a document performs no fetch for any hyperlink target. Activation is an explicit user gesture, always through the sanitized projection.

**Layout and paint**

- Hyperlink runs enter measurement and line breaking exactly like sibling runs. The style cascade resolves the `Hyperlink` character style (themed `hlink` color, underline) through the existing run-style path.
- Paint wraps each link's run spans in `a.docx-hyperlink` — external: `href` = sanitized projection; internal: `href="#<anchor>"`. Run spans inside keep the `data-paragraph-id`/`data-start`/`data-end` selection contract; the anchor element is paint furniture and never authoritative. `.docx-hyperlink` selection CSS already exists in the core stylesheet.
- Bookmarks occupy no space and paint nothing.

**Navigation**

- Native anchor navigation inside the editable surface is always prevented.
- Clicking an external link with a collapsed selection opens the hyperlink popover; a range selection ending on a link does not. Popover "open" is the only path to `window.open(sanitizedHref, '_blank', 'noopener,noreferrer')`.
- Clicking an internal link scrolls its bookmark target into view — including targets on virtualized, not-yet-painted pages — and places the engine caret at the bookmark's paragraph position. No popover.

**Editing operations**

- `TreeDocOp` gains the operations behind the already-declared contract edits `insertHyperlink` / `removeHyperlink` (`packages/core/src/index.ts`), plus set-target (edit URL and display text in place). Unlink lifts the runs out of the hyperlink; text and formatting survive.
- Implement the `hyperlinkAt` query (`contracts/editor.ts` — `HyperlinkInfo`), today an unimplemented typed-empty read in `docx-editor.ts`.

**React adapter — styleable `DocxEditor.HyperLink`**

- A new compound, following the `DocxEditor.Toolbar` customization ladder: `DocxEditor.HyperLink` renders the Google-Docs-style popover (URL readout, copy, edit, unlink; edit mode with text + URL inputs) with parts `HyperLink.Root/Url/Copy/Edit/Unlink` — `className`/`data-*` CSS first, `icon` prop, `asChild`, in-place part override (`hidden` removes, `preset={false}` opts out), and raw hooks (`useHyperlinkPopup()`) underneath. Mounted by default inside the viewport so scrolling moves it with the page; consumers can remount or replace it wholesale.
- Stable `data-testid`s (`hyperlink-popup`, `hyperlink-popup-copy|edit|unlink`), all strings through i18n keys, all colors through `--doc-*` tokens.
- Wire `text.link` in `SLOT_COMMANDS` (insert/edit link, Cmd/Ctrl+K) so the toolbar button enables through `toolbarCommandState` like every other slot.
- Vue: stays deferred with the rest of the provider/hooks twin; the Vue toolbar's link slot remains disabled with the engine's reason. This lane must not grow a one-off Vue popover.

## Capabilities

### New Capabilities

- `hyperlink-model`: typed `w:hyperlink` and bookmark point anchors in the canonical tree, relationship resolution and external classification, sanitized runtime projection with lossless authored save, and the insert/edit/unlink/`hyperlinkAt` operations.
- `hyperlink-layout`: hyperlink runs in measurement, line breaking, and paint with `Hyperlink` character-style resolution; the `a.docx-hyperlink` paint contract; bookmarks as zero-extent anchors.
- `hyperlink-navigation`: prevented native navigation, popover-gated external activation, and internal bookmark jumps with caret placement across virtualized pages.
- `hyperlink-ui-surface`: the styleable `DocxEditor.HyperLink` compound, its hooks, testids, i18n, and the `text.link` chrome-slot wiring.

### Modified Capabilities

None. `semantic-paragraph-layout` and `paragraph-adapter-acceptance` in `typed-ooxml-paragraph-editor` exclude hyperlinks from *their* acceptance; this lane adds its own capabilities rather than reopening those.

## Fixture evidence

- Section 9 of `e2e/fixtures/comprehensive-word-element-test.docx`: paragraph 9.1 carries the two external links (rels `https://example.com`, `https://www.anthropic.com`, both `TargetMode="External"`, display texts with a U+2019 apostrophe); paragraph 9.2 carries the three internal links (`w:anchor="section1|section6|section12"`, display texts with U+2013 en dashes).
- The document defines 22 bookmarks (`section1`–`section22`, ids 10–31), each a `w:bookmarkStart` on a `Heading1` paragraph. `section6` sits ~7 pages before section 9; `section12` sits several pages after — the jump targets exercise both scroll directions and virtualization.
- Current paint (verified in the demo at this change's authoring): 9.1 → "Visit  or .", 9.2 → "Jump to:  |  |"; zero `<a>` elements in painted pages.
- Acceptance: `e2e/hyperlinks.interaction.spec.ts` (added with this change) drives rendering, popover behavior, and both jump directions against this fixture.

## Impact

- `packages/core/src/store/package/ooxml-tree.ts` — node kinds, typed read/validate/serialize.
- `packages/core/src/store/package/sinks.ts` — consumed, not changed.
- `packages/core/src/store/store/tree-ops.ts` — insert/edit/unlink ops.
- `packages/core/src/binding/tree-binding.ts` — hyperlink children leave the `unknownLabel` placeholder path and join `tokensOfParagraph`.
- `packages/core/src/layout/*` — run-stream inclusion, `Hyperlink` style resolution.
- Paint + interaction surface — `a.docx-hyperlink` output, click routing, bookmark scroll/caret.
- `packages/core/src/editor/docx-editor.ts` — `hyperlinkAt`; `chrome-controls.ts` — `text.link` in `SLOT_COMMANDS`.
- `packages/react/src/editor/` — `DocxEditorHyperLink.tsx` compound + hooks; statics on `DocxEditor`.
- `packages/i18n/en.json` — popover strings; API Extractor snapshots (`bun run api:extract`).
- `e2e/hyperlinks.interaction.spec.ts` — paired acceptance.
