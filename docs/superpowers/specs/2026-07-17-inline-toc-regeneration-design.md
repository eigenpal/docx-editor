# Inline TOC regeneration

## Goal

Show a Google Docs-style regenerate control beside every table of contents while it is hovered or contains the selection. The control updates that TOC without a browser confirmation dialog and behaves identically in React and Vue.

## Verified reference behavior

Google Docs' current help documentation instructs users to add or change headings and then click the adjacent Refresh icon to update the table of contents. The interaction is inline rather than a browser prompt. The editor keeps the action manual and available on every TOC because derived stale detection cannot reliably represent every imported field, unsupported switch, or layout edge case.

## Stale definition

A TOC is stale when regenerating it from the current document and completed page layout would change any visible generated result:

- heading inclusion, removal, order, text, or outline level;
- generated hyperlink/bookmark target;
- displayed page number;
- an imported field is dirty or has an empty result.

Unrelated edits that leave every generated entry unchanged do not mark the TOC stale. Staleness is derived at runtime and is not persisted into ProseMirror attributes or OOXML, so checking it does not create history entries or alter saved documents. It remains available as an advisory core query, but it does not gate the refresh control or a user-requested regeneration.

## Architecture

### Shared core comparison

Extend the core TOC module with a framework-neutral stale-result comparison. It reuses the existing instruction parsing, heading collection, page-number resolution, and result generation used by `updateTableOfContents`, then compares a normalized generated-entry signature with the current TOC content. The result remains useful to consumers as advisory state. The refresh UI uses all blocks returned by `findTableOfContentsBlocks`.

The comparison accepts the current `PageLayout`. Until layout is available, dirty/empty imported fields remain stale, but page-number comparison waits for layout to avoid false positives.

### Shared painted affordance

Add a core painter helper that synchronizes refresh controls into the already-painted `.layout-block-sdt-box` elements. For each TOC it:

- finds the boundary by its stable `data-sdt-group-id`;
- appends one pointer button directly to the boundary, positioned 8px outside its left edge near the top;
- assigns stable `data-toc-refresh` and TOC-position attributes;
- uses DOM creation and `textContent`/attributes only;
- removes obsolete controls when the TOC disappears or the editor becomes read-only.

Shared core CSS presents the control as a 32px white floating action button with the same border, radius, shadow, and hover treatment as the editor's floating comment action. It is hidden by default and revealed when the boundary is hovered, selected, or keyboard-focused. The button re-enables pointer events, uses existing editor tokens, and remains absent in read-only mode.

### Adapter integration

React and Vue call the same synchronization helper after each painted-pages-ready signal, passing the live PM document and translated `contextMenu.updateTableOfContents` label. Their existing persistent content-control widget delegates handle pointer activation, prevent caret movement on mousedown, and call the existing per-position TOC update action.

React intentionally hides painted pages from the accessibility tree to avoid duplicating the offscreen editor. Both adapters therefore render one native accessible proxy button per TOC outside the painted pages root. Painted buttons are pointer-only; proxy focus reveals and outlines the corresponding floating button, and native Enter/Space activation regenerates exactly once.

The existing load-time `window.confirm` prompt is removed in both adapters. Context-menu and public-ref regeneration remain supported.

## Interaction

1. Painting identifies every recognized TOC boundary.
2. Each editable TOC receives a left-floating refresh control.
3. Hovering the TOC, placing the caret inside it, or focusing its accessible proxy reveals the control.
4. Clicking or keyboard-activating the control forces regeneration of only that TOC, regardless of advisory stale state.
5. The existing second layout/update pass resolves page numbers.
6. The control remains available for later manual refreshes.

## Accessibility and localization

The accessible proxy is a native `button` with the translated “Update table of contents” accessible name and tooltip. Enter and Space activate it. The painted pointer control is hidden from assistive technology and removed from the tab order. Mousedown is prevented from stealing the ProseMirror selection, and proxy focus produces a visible outline on the corresponding painted control.

## Testing

- Core unit tests cover heading text/level/add/remove changes, changed page numbers, unchanged unrelated edits, dirty/empty imports, and current TOCs.
- Painter helper tests cover all-TOC creation, deduplication, cleanup, stable datasets, translated labels, and pointer-only attributes.
- The React/Vue parity E2E test inserts a TOC, verifies the left-floating button appears only on hover/focus, activates it after a heading change, and confirms the control remains available for another manual refresh.
- Accessibility coverage verifies the native proxy is outside every `aria-hidden="true"` ancestor and maps to the correct TOC.
- Targeted typecheck, adapter CSS thinness, TOC unit tests, and TOC parity Playwright coverage must pass.

## Non-goals

- Automatically regenerating TOCs after every edit.
- Using advisory stale detection to hide or disable the manual refresh action.
- Persisting a custom dirty marker in DOCX or ProseMirror state.
- Changing TOC formatting, supported field switches, or public ref APIs.
- Removing the existing context-menu update command.
