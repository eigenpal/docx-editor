# Handoff: PR #901, content-control widgets, pop-ups, and form controls

Branch `feat/content-control-widget-parity`, worktree
`.claude/worktrees/mellow-giggling-stream`, PR https://github.com/eigenpal/docx-editor/pull/901.
Head commit `19196f400` (on top of a merge of `main`, `c03b5be95`). The PR body ends with
`Fixes #905`, `Fixes #906`, `Fixes #907`, so merging closes those three issues.

## Codex follow-up (2026-09-17)

- Fixed the date popup anchor: prompt selection precedes opening in both pointer paths;
  the observer finds replacement chrome through the panel's editor root.
- Added connected-anchor and detached-anchor regression tests. Full suite: 14634 pass,
  0 fail. Browser interaction suite: 19 pass against React on 5183 and Vue on 5274.
- Reworked the composition guide and PR description around typed React parts, Vue
  template children, registration, custom actions, and error handling. React snippets
  type-check; the Vue single-file component compiles. Documentation checks pass.
- Cursor flicker remains unreproduced. The diagnostic notes below still apply.
- The PR remains open for review; the original manual checklist is not a claim that
  every item was repeated in this follow-up.

## Status at handoff

- Local gates on `19196f400`: `bun run test` 14632 pass, 0 fail; the pre-commit hook passed
  formatting, collaboration policy, typecheck, parity, license headers, API snapshot, and lint.
  `bun run i18n:validate` and `openspec validate typed-ooxml-paragraph-editor --strict` passed
  on the commit before the merge; the Playwright spec
  `e2e/content-control-widget.interaction.spec.ts` passed (19 cases) on the commit before the
  merge. Rerun the Playwright spec once before merging.
- CI on `bdd823b2d` (the handoff commit on top of `19196f400`) passed: `CI`, `Performance
benchmark`, `Python wheels`, and `CLA`. The `Python wheels` run is not from this PR: `main`
  gained the Python package in #903, the merge of `main` carried its files, and the workflow's
  `pull_request` path filter matched them. It builds wheels and nothing else.
- The `pull_request` workflows do not run while the PR conflicts with `main`. That is what
  happened on `d6445e68d` (three PRs landed on `main` first); the merge commit fixed it. If CI
  is missing again, check `gh pr view 901 --json mergeable` before anything else.
- Three Codex reviews (`gpt-6-astra`, high) ran against local Word and staged fixes that are
  in the commits below. Their reports are outside the repo; the findings that matter are
  listed under "Known limitations".

## Finish with Codex

The rest of this PR is to be finished with Codex. What is left:

1. The date bug is fixed in the Codex follow-up. Investigate cursor flicker only if it reproduces.
2. Rerun `bunx playwright test e2e/content-control-widget.interaction.spec.ts` after the merge
   of `main` (the unit suite ran, the browser spec did not).
3. Walk the manual checks under "What to check" once in the browser.
4. Merge. Squash is the repo's default; the PR body is current.

Rules for Codex on this branch:

- Do not run `bun install` in the sandbox without network; it relinks `harfbuzzjs` to an old
  version. Use `bun install --frozen-lockfile` only if `node_modules` is missing.
- Do not raise a line cap. `paginated-surface.ts` sits at 6153 with the cap at 6300 (raised
  on `main`); `tree-op-apply.ts` and `tree-op-content-controls.ts` sit at their caps. Extract.
- `bun run api:check` reports drift when `dist/` is stale. Run `bun run build:packages` first,
  then `bun run api:extract` if the snapshot really changed.
- Never add a `.docx` other than the two named under "Rules that bit"; never write personal
  names or the reporter's identity anywhere in the repo, the PR, or the commits.

## What changed, by commit (newest first)

1. `19196f400` a caret after a content-locked chip types beside it.
   - `packages/core/src/editor/content-control-prompt-landing.ts` `insertOwnerOf`: the insert
     owner is named only for a control that takes typing. A content-locked chip, a checkbox, or
     a picture is an atom, so a keystroke at its trailing edge lands beside it (the full suite
     caught this in `packages/pro/src/__tests__/insert-custom-node.test.ts`).
2. `c03b5be95` merge of `main`. Four conflicts, all keep-both: the surface line cap (6300 from
   `main`), the editor index export blocks, the React hooks table (main's wording plus the
   `useContentControlWidget()` row), and the surface (the refusal helper plus `main`'s
   history group).
3. `d6445e68d` typing stays inside a control, and the igloo deep-water pop-ups.
   - `packages/core/src/editor/paginated-surface.ts` `type()` names the caret's control as the
     insert's owner (`insertText.inside`, an existing store field) when no prompt replace is
     planned. Before, the second keystroke after a prompt replace sat on the control's trailing
     edge and landed outside it, so the control "collapsed" to one character.
   - `packages/core/src/editor/content-control-at-selection.ts`: a collapsed caret on a
     control's trailing edge counts as inside (probed a quarter point to its left), as in Word.
     ArrowRight is what leaves the control.
   - `packages/core/src/store/store/tree-op-segments.ts`: with an owner named, an insert at the
     end of a hyperlink or other inline wrapper inside that owner lands after the wrapper, not
     inside the link. Tests: 'typing stays inside the control' in
     `packages/core/src/editor/__tests__/content-control-surface.test.ts`.
   - `examples/igloo/src/IglooForms.tsx` and `igloo.css`: the permit pop-ups restate the
     `--doc-*` tokens as a dark palette under
     `.docx-editor .docx-content-control-widget-popup.igloo-permit` (the engine rule outranks a
     bare class, so the selector must keep that specificity). The date pop-up uses a native
     `<input type="date">` (the system picker on macOS and Windows, `color-scheme: dark`) with
     an "Ice calendar" switch back to the packaged calendar parts.
4. `66a97e6d0` hover tracking, active state for a selected prompt, prompt press opens lists.
   - `packages/core/src/editor/content-control-hover.ts`: the chrome layer passes pointer
     events through to the text, so CSS `:hover` never fired on the chrome. The surface now
     scans the boundary boxes on the page under the pointer once per frame and sets
     `data-hover` on the matching chrome. TOC chrome keeps its own hover projection.
   - `packages/core/src/editor/content-control-at-selection.ts`: a prompt selected whole ends
     on the control's outer edge, where the head probe fell outside the fragment. The active
     control is now probed a quarter point inside both ends of a range.
   - `packages/core/src/editor/surface-pointer.ts`: a single press on the prompt of a
     dropdown, combo box, date, or gallery control also calls `onContentControlWidget`, so the
     menu opens in one step (`LIST_PROMPT_TYPES`).
5. `8ac6481e2` prompt edge typing, prompt restore on empty, hover-only widgets, igloo style.
   - `packages/core/src/editor/content-control-prompt-landing.ts`: the store replaces a
     `w:showingPlcHdr` prompt when text lands at either edge, so text goes where the prompt
     began. The surface's `type()` now places the caret from that landing. Before, the caret
     stayed at the pressed offset past the paragraph's new end, and later keystrokes landed in
     the next paragraph (the merged lines and lost characters in the reports).
   - `packages/core/src/store/store/content-control-prompt-restore.ts`: a control emptied by a
     content edit gets the type's prompt back under `w:showingPlcHdr` (called from
     `finishContentEdit` in `tree-op-apply.ts`). Two tests in
     `packages/core/src/store/__tests__/content-control-ops.test.ts` were rewritten from the
     old "no restore" contract.
   - `packages/core/src/editor/surface-range-edit.ts`: Backspace and Delete at a control's
     edge take the control as one unit only for content-locked chips, checkboxes, and
     pictures. Text, date, and list controls delete one character, as in Word. This was the
     "clicking and typing over the rich-text control loses the control" report.
   - `packages/core/src/styles/editor.css`: widgets (except the checkbox target) are
     `opacity: 0` until `data-hover`, `data-active`, `data-open`, `data-boundary-visible`,
     chrome `:hover`, or `:focus-visible`.
   - `examples/igloo/src/igloo.css`: the permit's controls are styled as carved slots (dashed
     teal underline, aqua glow when active, teal label tab, round aqua button).
6. `21cc50327` glossary placeholders for empty controls, checkbox chrome, igloo permit, and
   the Codex round-3 fixes.
   - `packages/core/src/store/store/placeholder-materialize.ts`: a control saved with empty
     `w:sdtContent` (Word does this for an unfilled date control) opens showing the glossary
     block its `w:placeholder/w:docPart` names, or the type default, under `w:showingPlcHdr`.
     Wired next to `normalizeParagraphIdentity` in `binding/tree-session.ts`,
     `automation/server-host.ts`, and `store/headless-document-view.ts`.
   - `packages/core/src/layout/content-control-boundary-layout.ts`: a symbol checkbox control
     has a zero-length range; its zero-width projected span's box now serves as the control's
     geometry, so the widget hugs the glyph. Inline drawings also join a control's geometry,
     which a picture control needs to paint a widget at all.
   - `examples/igloo/public/expedition-permit.docx` (generated, no personal data) plus
     `examples/igloo/src/IglooForms.tsx` and `notice.ts`: every content control with its own
     pop-up (`PERMIT_POPUPS` on the root). Opened from **Custom Actions** > **Paperwork**.
   - Codex round-3 fixes: `store/store/building-block-safety.ts` (refuses gallery bodies that
     reference styles, numbering, notes, bookmarks, fields, or media),
     `building-block-identities.ts` (nested `w:id` and paragraph identities on repeated
     picks), picture pick lifetime and mode rechecks in `content-control-picture-widget.ts`
     and `surface-image-ops.ts`, a 32 MiB input cap, `drawing-content-edit.ts` (placeholder
     and temporary-wrapper handling on picture replace), retry and Cancel in the React and
     Vue picture pop-ups, and a shared empty-gallery note.
7. `31d898254` picture replace widget, building block gallery, leading `w:sym` layout.
   - Picture control: `content-control-picture-widget.ts`; session kind `picture` with
     `value` = drawing node id and `replaceImage(bytes)`; engine fallback is a hidden file
     input on the pages layer; adapters get `popups.contentControlPicture`,
     `DocxEditorContentControlWidget.Picture`, and `useContentControlWidget().replaceImage`.
   - Building block gallery: `store/package/building-blocks.ts` reads the glossary part;
     new op `insertBuildingBlock` in `store/store/building-block-insert.ts` (registered in
     kinds, types, validate, apply, reach map, the mutation manifest, and the journal
     coverage fixture); session kind `buildingBlockGallery` is list-shaped and joins the
     default renderer kinds; `setValue` on a gallery control resolves the block by name.
   - `layout/paragraph-flow.ts`: a zero-width projected piece at offset 0 (a leading `w:sym`,
     for example a checkbox glyph alone in a cell) no longer drops out of layout.
     `layout/semantic-interaction.ts` `caretSpan` skips zero-width projected spans so the
     toolbar font at offset 0 reads the run, not the glyph face. The docx-to-markdown pin in
     `packages/docx-to-markdown/test/node-defaults.test.ts` moved by exactly those glyphs.
8. Earlier commits on the branch (widget parity, shared pop-up behavior, legacy
   `FORMCHECKBOX` toggling, composable React and Vue parts) are described in the PR body.

## Open bugs

### 1. Fixed in Codex follow-up: date pop-up lands at the page's bottom-left after a press on the prompt (igloo and any host renderer)

Reproduced in the igloo permit (`bun run dev:igloo`,
`http://localhost:5178/?fixture=expedition-permit.docx`): press the **Departure** prompt text
(not its button). The pop-up renders at the page's bottom-left corner, below the sheet, and the
native date input's focus scrolls that corner into view. A press on the widget button places
the pop-up correctly under the control.

Cause, verified with a probe in the browser:

- `packages/core/src/editor/surface-pointer.ts`, placeholder branch of `onPointerDown` (search
  `LIST_PROMPT_TYPES`): the prompt press calls `host.onContentControlWidget(...)` BEFORE
  `host.selectContentControl(...)` / `host.setSelection(...)`.
- `packages/core/src/editor/content-control-widget-session.ts` resolves the session's `anchor`
  at open time as the control's painted `.docx-content-control-boundary` element.
- The selection change that follows repaints the control chrome, so that anchor element is
  detached by the time the host's pop-up mounts (its rect reads `0,0,0,0`).
- `packages/core/src/editor/content-control-popup-behavior.ts` `observeContentControlPopup`
  finds the pages layer with `anchor.closest('.docx-pages')`. For a detached anchor that is
  `null`, so the re-anchoring lookup never runs, `current.isConnected` stays false, and
  `positionContentControlPopup` is never applied. An absolutely positioned pop-up with no
  `top`/`left` sits at its static position in `.docx-content-mount`: after the pages, at the
  page's bottom-left.

Fix, both halves:

- Engine order: in the placeholder branch, call `host.onContentControlWidget` AFTER the
  selection is applied, in both the `selectContentControl` branch and the
  `placeholderSelectionRange` fallback, so the session's anchor is the repainted boundary.
- Observer robustness: resolve the layer as
  `anchor.closest('.docx-pages') ?? panel.closest('.docx-editor')?.querySelector('.docx-pages')`
  and keep the control id from the anchor's `[data-docx-content-control]` ancestor (that
  ancestor survives in the detached subtree), so a stale anchor re-anchors on the first
  `update()`.

Tests to add:

- `packages/core/src/editor/__tests__/content-control-surface.test.ts`, in 'a press on a list
  prompt': capture the session through a `contentControlWidget` renderer on the surface, and
  assert `session.anchor.isConnected` is true after the press and that the anchor is the
  boundary of the now-active chrome.
- `packages/core/src/editor/__tests__/content-control-popup-behavior.test.ts`: observe a panel
  with an anchor that has been removed from the layer while a replacement chrome with the same
  control id exists, and assert the panel gets `style.top`/`style.left` from the replacement.

### 2. Reported cursor flicker (I-beam vs arrow) on hover over the form-controls catalog

Reported from a screenshot of the catalog fixture with the picture control highlighted. Not
reproduced on this branch served from this worktree (port 5183, `bun run dev` in
`examples/vite`):

- Trusted-mouse Playwright sweeps across and through the picture control, and a stationary
  real-mouse hover on the picture and date widgets: the element under the pointer and its
  computed cursor stay constant per region; no `childList` mutations under `.docx-pages`;
  `data-hover` toggles only at control edges.
- The hit-test stack over a control is identical in idle, hover, and active states. The chrome
  and its boundary compute `pointer-events: none`, so they never take the cursor.
- The other dev server on port 5173 belongs to a different worktree and branch without this
  PR's hover code; make sure the report comes from this branch.

If it reproduces: check `packages/core/src/editor/content-control-hover.ts` (one
`elementFromPoint` plus boundary `getBoundingClientRect` scan per frame on `pointermove`) and
whether anything under the pointer is replaced per frame. A quick way to see: a
`MutationObserver` on `.docx-pages` with `childList: true, subtree: true` while moving.

## What to check

Manual, in the browser (`bun run dev`, then `http://localhost:5173/?fixture=form-controls-catalog.docx&e2e=1`;
use `localhost`, not `127.0.0.1`, when another worktree's server holds the same port):

- Hover any control's text: its button appears and fades out when the pointer leaves.
- Click the prompt of the dropdown, the combo box, the date, and the gallery: the prompt is
  selected, the control stays highlighted, and the menu opens. Escape closes it and returns
  focus to the page.
- Date control: click in front of the prompt, press ArrowRight, press Space, then type.
  Text must land inside the control and the next paragraph must be untouched.
- Rich-text control: click the prompt, type three letters, then a fourth. All four must sit
  inside the control (save and inspect `w:sdtContent`). Press ArrowRight and type: that
  character lands beside the control.
- Rich-text control: click the prompt, type two letters, press Backspace three times. After
  the second Backspace the prompt returns; the third deletes the space before the control.
  The control must never disappear.
- Picture control: press the widget, pick a PNG. The image is replaced at the same size.
  Undo restores it. Cancel the dialog: nothing changes.
- Gallery control: the menu lists **Address block** and **Sign-off line**; a pick replaces the
  prompt; undo restores it. Save and reopen (`window.__DOCX_EDITOR_E2E__.saveAndReopen()`).
- Checkbox: hover shows a soft tint hugging the glyph, no second box; click and Space toggle.
- Igloo demo (`bun run dev:igloo`, `http://localhost:5178/?fixture=expedition-permit.docx`):
  each control opens a dark pop-up over the page; "Freeze today", a carved sled photo, a
  glossary brief, and a checkbox notice all land in the document. The date pop-up opens the
  system picker; the "Ice calendar" switch shows the packaged calendar instead.

Review points worth a second pair of eyes:

- `restoreEmptiedPlaceholder` runs from `finishContentEdit` for every content edit whose
  caret sits in a control. A deletion that covers a whole control from outside does not
  restore it. Decide whether that case should.
- `contentControlAtSelection` probes a quarter point inside range ends, and a collapsed caret
  a quarter point to its left. Check a control at a line end, a control that spans two lines,
  and two controls that touch (the caret between them belongs to the first).
- `insertText.inside` is only set by `type()`, and only for controls that take typing
  (`insertOwnerOf`: not content-locked, not checkbox, not picture, so a caret after a locked chip
  types beside it). Paste, IME commit, and automation inserts at a control's trailing edge still
  land outside. Decide whether they should name the owner too.
- `content-control-hover.ts` scans boundary boxes with `getBoundingClientRect` once per
  frame on the page under the pointer. Check the cost on a page with hundreds of controls.
- The prompt press opens the menu on `pointerdown` before the selection settles. Check that
  a drag that starts on a prompt still selects normally, and that touch input behaves.
- `building-block-safety.ts` refuses any gallery block that references a style, even one the
  main part defines. Real Quick Parts usually carry `w:pStyle`. Decide whether to allow
  references the main part resolves, or to add a package merge.
- `materializeGlossaryPlaceholders` runs only on the main document part. Headers, footers,
  and notes with empty controls still open as gaps.

## Known limitations left on purpose

- Gallery blocks that need resources from the glossary (styles, numbering, media, notes)
  return `unsupported`. Blocks from Word's Building Blocks template are never available.
- A picture control without a drawing has no widget; replacement is the only picture op.
- Word resizes a replaced picture to the source's aspect ratio; the engine keeps the extent.
- The citation control opens empty (it has no prompt kind).
- Duplicate block names in one gallery refuse the pick rather than choosing one.

## Rules that bit during this work

- Line caps: `paginated-surface.ts` is at 6143 of 6150, `tree-op-apply.ts` at 3495 of 3495,
  `tree-op-content-controls.ts` at 1850 of 1850. Extract into a module; never raise a cap.
  `scripts/check-eslint-max-lines-globs.mjs` runs inside `bun run lint`.
- `bun run api:extract` re-emits stale snapshots unless `bun run build:packages` ran first.
- Running `bun run test` while a build runs produces spurious `Cannot find module
'@docx-editor.dev/i18n'` failures and perf-test timeouts. Rerun the files alone.
- Only the scrubbed `e2e/fixtures/form-controls-catalog.docx` and the generated
  `examples/igloo/public/expedition-permit.docx` may be used in tests, screenshots, or docs.
  Never add another `.docx`, and never write personal names or the reporter's identity.
- Glossary `w:types/w:type` values must be schema values (`normal`, `bbPlcHdr`); invalid ones
  are filtered out silently by the reader.
- Vue tests that call `useContentControlWidget()` inside `setup()` need the
  `react-hooks/rules-of-hooks` disable comment the other Vue tests carry, or lint-staged
  fails the commit.

## Pointers

- Docs: `docs/site/content/guides/content-controls.mdx`,
  `docs/site/content/guides/customize-dialogs.mdx`, `docs/site/content/react/hooks.mdx`,
  `docs/site/content/vue/composables.mdx`, `docs/site/data/word-features.ts`.
- Changeset: `.changeset/content-control-widget-parity.md` (core, minor).
- Collaboration decision: `.collaboration/changes/content-control-widget-parity-decision.json`
  (covers `setLegacyCheckbox` and `insertBuildingBlock`).
- Mutation manifest counts: 82 op kinds, 69 single-part appliers.
- Igloo showcase: `examples/igloo/README.md` has a "Compose the content-control pop-ups"
  section.
