## Context

`w:hyperlink` is currently an unknown inline child in the tree binding: `tokensOfParagraph` emits it as a single placeholder token, so its runs never reach measurement, and paint shows nothing. Bookmarks are generic zero-length children whose split placement is already correct (`tree-op-split-anchors.test.ts`). `sanitizeHref`/`escapeXml` exist in `store/package/sinks.ts` with no consumer. The contract layer already declares `insertHyperlink`/`removeHyperlink` edits and the `hyperlinkAt` query with `HyperlinkInfo`; `createDocxEditor` returns the typed-empty read. `text.link` exists in `ChromeSlotId` and `CHROME_GROUPS` but not `SLOT_COMMANDS`.

The React adapter is provider-first: `DocxEditor.Root/Viewport/Content/Toolbar/Loading` statics over context + hooks, with the toolbar's customization ladder (`className`/`data-*` → `icon` → `asChild` → in-place part override → raw hooks) as the established pattern for consumer styling.

## Goals / Non-Goals

**Goals:**

- Hyperlink run text is never dropped: it is measured, painted, selectable, and editable like sibling runs.
- External activation is popover-gated, sanitized, and never zero-click; internal links navigate to bookmarks including unmounted virtualized targets.
- One styleable popover compound, `DocxEditor.HyperLink`, consistent with the toolbar's customization ladder.
- Lossless save: authored targets, tooltips, `w:history`, `w:docLocation`, `w:tgtFrame`, and bookmark ids re-emit as authored.

**Non-Goals:**

- Vue popover or Vue `text.link` wiring (rides with the Vue provider/hooks twin).
- `a:hlinkClick` on drawings (drawings lane), `HYPERLINK` field instructions and TOC field links (fields lane), followed-link (`folHlink`) visited-state tracking.
- Bookmark authoring UI (insert/rename bookmarks); only navigation targets are in scope.
- Link-preview fetching of any kind.

## Decisions

**D1 — Typed node carries both the authored target and the sanitized projection.**
The `hyperlink` node keeps the raw relationship target / anchor exactly as authored (save path), and exposes `sanitizedHref: string | null` computed once through `sanitizeHref` at tree construction (runtime path). Paint, navigation, and the popover consume only the projection; serialization consumes only the authored value through `escapeXml`. Alternative — sanitizing at paint time — was rejected: it scatters the trust boundary across every consumer, which is exactly what the security contract forbids.

**D2 — Paint emits a real `<a class="docx-hyperlink">` per line fragment, as furniture.**
Lines are absolutely positioned, so a link that wraps paints one anchor element per line, each wrapping that line's run spans. Run spans keep `data-paragraph-id`/`data-start`/`data-end`; the anchor contributes semantics (`href`, `title` from `w:tooltip`, native focus/announcement) but is never authoritative for selection or hit-testing beyond click classification. Alternatives: `data-href` on bare spans (loses native link semantics and accessibility for zero benefit); one anchor spanning lines (impossible in the absolute line model). An inert link (sanitization refused the scheme) paints the same element with no `href`.

**D3 — Click classification, not native navigation.**
The surface's pointer path prevents default on any `a` inside pages. A click with a collapsed selection on an external link opens the popover; on an internal link it navigates; with a range selection it does neither (drag-selections that end on a link must not pop). `window.open(sanitizedHref, '_blank', 'noopener,noreferrer')` happens only from the popover's open action — one call site, matching the "explicit user activation" gate. Ctrl/Cmd+Click follows Word and opens directly, through the same single gate.

**D4 — Bookmark navigation resolves through layout geometry, not the DOM.**
The session maintains a bookmark index `name → { paragraphId, offset }` from typed anchors. A jump asks layout for the paragraph's page/y and drives the scroll container there, then places the engine caret (`caretAt`) at the target position. DOM `scrollIntoView` was rejected: the target paragraph of a cross-document jump is usually virtualized out and has no DOM. An unresolved anchor is an inert click (Word's behavior). Duplicate bookmark names: first in document order wins.

**D5 — Popover mounts inside the viewport; position is computed once per open.**
Mounted within the scroll container so CSS keeps it attached to the page while scrolling (no scroll listeners). Position = link fragment rect at click time, below the line, clamped horizontally to the viewport. Dismiss on Escape, outside mousedown, or selection movement. z-index comes from the stylesheet, not an inline constant.

**D6 — `DocxEditor.HyperLink` is a compound over a headless hook.**
`useHyperlinkPopup()` (context-backed) exposes `{ state, open(pos?), close, copy, beginEdit, commitEdit, unlink }`; the default popover is parts — `HyperLink.Root/Url/Copy/Edit/Unlink` — each following the toolbar ladder (`className`/`data-*` first, `icon`, `asChild`, part override in place, `hidden`, `preset={false}`). `DocxEditor` sugar renders it by default; `hyperlinkPopup={false}` removes it; a `<DocxEditor.HyperLink>` child replaces the preset in place. Read-only mode renders URL + copy only. All strings via i18n keys; stable `data-testid`s (`hyperlink-popup`, `-copy`, `-edit`, `-unlink`) so tests and consumers never select on localized text or `title` attributes, which are locale-dependent.

**D7 — Edit and unlink are tree ops that preserve everything they don't touch.**
Set-target rewrites the relationship (or anchor) and optionally replaces the display runs; unlink splices the hyperlink's children into the paragraph in place, keeping run formatting and any contained anchors. Both are single `transact` calls so undo is one step. `hyperlinkAt` walks the caret's paragraph for the enclosing typed hyperlink and returns `HyperlinkInfo` per the existing contract shape.

## Risks / Trade-offs

- [A `w:hyperlink` wrapping non-run content — drawings, fields, nested SDT] → children beyond runs/anchors stay `generic`; the link types, its runs paint, unknown children keep their positions. Never demote to invisible.
- [Links inside header/footer furniture are focusable `<a>`s in non-editable chrome] → furniture anchors paint styled but inert (`tabindex="-1"`, no `href`); activation there is deferred until HF editing lands.
- [Per-line anchors double DOM nodes on link-heavy documents] → anchors are emitted only for hyperlink runs, not universally; measured in the paint benchmarks before/after.
- [Popover steals focus from the surface and drops the caret] → popover chrome follows the toolbar rule: mousedown `preventDefault()` except in its text inputs.
- [`w14:paraId`-based features landing in parallel] → the bookmark index keys on the store's node ids, not paraId, so the two lanes stay independent.

## Migration Plan

Additive lane; no data migration. Land order: typed nodes + save (model), layout/paint, navigation, editor ops + `hyperlinkAt`, React compound + slot wiring, acceptance green (`e2e/hyperlinks.interaction.spec.ts`). Each stage keeps `bun test` and the D9 oracles green; the e2e suite stays red until the final stage and gates archive.

## Open Questions

- Keyboard activation of a link at the caret (Word: Ctrl+K reopens edit; Enter does nothing) — proposed: no Enter activation, `text.link` command opens edit mode for the link at the caret.
- Whether the popover shows `w:tooltip` alongside the URL or only as the anchor's `title` — proposed: title only, revisit with user feedback.
