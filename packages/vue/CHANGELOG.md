# @eigenpal/docx-editor-vue

## 1.8.1

### Patch Changes

- Updated dependencies [6047f84]
  - @eigenpal/docx-editor-core@1.8.1
  - @eigenpal/docx-editor-agents@1.8.1
  - @eigenpal/docx-editor-i18n@1.8.1

## 1.8.0

### Patch Changes

- Updated dependencies [274e45f]
- Updated dependencies [a1f4537]
- Updated dependencies [27740e1]
- Updated dependencies [114e83e]
  - @eigenpal/docx-editor-agents@1.8.0
  - @eigenpal/docx-editor-core@1.8.0
  - @eigenpal/docx-editor-i18n@1.8.0

## 1.7.0

### Minor Changes

- c0923f7: Add `commentsSidebarOpen` and `onCommentsSidebarOpenChange` to `<DocxEditor>` for controlling the comments sidebar's visibility. When `commentsSidebarOpen` is set it becomes the source of truth; `onCommentsSidebarOpenChange` (React prop / Vue `comments-sidebar-open-change` event) fires whenever the editor wants to open or close it. Lets consumers that hide or replace the toolbar (`showToolbar={false}`) toggle the sidebar themselves, or open it programmatically. Omit both to keep the default self-managed behavior.
- 769f1f5: Add the `showHelpMenu` prop to the Vue editor (default `true`) to hide the Help menu in the menu bar, matching the React adapter.
- 78af476: Add `onOpen` and `showFileOpen` props so Vue consumers can route File > Open through their own import pipeline or hide the built-in Open action.

### Patch Changes

- 6be8146: Fix the document outline toggle button and outline panel overlapping the ruler in the Vue editor when the ruler is shown. Both now sit below the ruler row, matching React. Fixes #887
- 36a7414: Fix the Vue comments-sidebar toggle being stuck closed. The new `commentsSidebarOpen` prop is a Boolean, and Vue casts an absent Boolean prop to `false`, so the editor read it as controlled-closed and the toolbar button could never open the sidebar. It now defaults to `undefined` (uncontrolled), matching React.
- e740694: Fix the Vue editor layout shifting left and missing horizontal scroll on narrow viewports by enabling horizontal overflow on the pages viewport and enforcing minLayoutWidth.
- 421faf1: Support tracked changes (Suggesting mode) in headers and footers for both React and Vue components, including card positioning in the sidebar and command support.
- edd0bc2: Add themeable document-scrollbar CSS variables and apply the styled scrollbar to both React and Vue document scroll containers.
- 94b5816: Fix the Vue right-click context menu (and image menu / tooltips) rendering unstyled — transparent, with no border or shadow. They teleport into `<body>`, outside the editor's `.ep-root` where the `--doc-*` color tokens are defined, so every token resolved to empty. The teleported roots now re-apply the editor's `.ep-root` (and current light/dark theme) so the tokens resolve.
- Updated dependencies [ed04d10]
- Updated dependencies [35b5cee]
- Updated dependencies [186598a]
- Updated dependencies [2dedf30]
- Updated dependencies [dfd316f]
- Updated dependencies [6b1897a]
- Updated dependencies [8e95d60]
- Updated dependencies [f2c9f9f]
- Updated dependencies [fc95983]
- Updated dependencies [edd0bc2]
- Updated dependencies [d4a27d4]
  - @eigenpal/docx-editor-core@1.7.0
  - @eigenpal/docx-editor-agents@1.7.0
  - @eigenpal/docx-editor-i18n@1.7.0

## 1.6.2

### Patch Changes

- 768b10e: Redesign the document outline toggle as a filled circular button in the left gutter (instead of a bare icon), tighten the outline panel's indentation, and keep the toggle and panel clear of the vertical ruler and of landscape pages.
- 0ac0a4f: Localize the document outline toggle button's tooltip and label so they follow the editor's `i18n` prop instead of always showing English.
- Updated dependencies [a8bce7a]
- Updated dependencies [768b10e]
  - @eigenpal/docx-editor-core@1.6.2
  - @eigenpal/docx-editor-agents@1.6.2
  - @eigenpal/docx-editor-i18n@1.6.2

## 1.6.1

### Patch Changes

- Updated dependencies [7c1d1ff]
- Updated dependencies [c25ba18]
- Updated dependencies [26a048f]
- Updated dependencies [74ae87d]
- Updated dependencies [a89af59]
- Updated dependencies [6550426]
- Updated dependencies [4a75c5e]
  - @eigenpal/docx-editor-agents@1.6.1
  - @eigenpal/docx-editor-i18n@1.6.1
  - @eigenpal/docx-editor-core@1.6.1

## 1.6.0

### Minor Changes

- 5509418: Add a `colorMode` prop (`'light' | 'dark' | 'system'`) for native dark mode. Dark mode re-themes the editor chrome through the shared design tokens and renders the document canvas like Word's dark view: a dark page with light text where authored colours are lightness-inverted (hue preserved) for legibility. It is a display transform only; the saved DOCX is unchanged. `'system'` follows the OS `prefers-color-scheme`.

### Patch Changes

- 3a4a03f: Fix toolbar dropdowns closing when you scroll inside them. Scrolling the font size picker's preset list now keeps the dropdown open instead of dismissing it. Fixes #808.
- bbda628: Apply selected font picker options by their primary family name so CSS fallback stacks like Lato, sans-serif do not get stored as document font names.
- 7fe09f0: Share the paragraph-style-picker preview logic between the React and Vue toolbars. The filter/sort and per-style preview CSS now live once in `@eigenpal/docx-editor-core/utils/stylePreview` (`resolveParagraphStyleOptions` + `getStylePreviewProps`), which both adapters call, so the style dropdown can no longer drift between them. Also fixes a Vue toolbar bug where typing a font size and then clicking a preset could re-commit the typed value over the preset.
- 7fe09f0: Align the React and Vue toolbar controls. The Vue font-size control is now an editable, clearly-bordered input box (matching React) instead of a plain button, and React's zoom control is now a − / + stepper around the level dropdown (matching Vue), so both adapters present the same editable zoom and font-size controls.
- 7fe09f0: Unify the editor UI colors onto one CSS-variable token palette. The canonical chrome stylesheet now lives in `@eigenpal/docx-editor-core` (`packages/core/src/styles/editor.css`) and both adapters import it, so React and Vue can never drift. Component styles reference `--doc-*` tokens instead of hardcoded colors, and the shadcn HSL tokens are aligned to the same palette and support opacity modifiers. A commented `.ep-root.dark` scaffold is included as the structure for a future dark theme (no dark values are shipped yet — adding the `dark` class has no visual effect until they are filled in). Light-mode appearance is unchanged apart from minor consolidation of near-duplicate grays/blues. As part of this, the Vue full-screen loading overlay now uses the same dark backdrop with light text as React (previously a light backdrop), and the Vue editing-mode chip and toolbar dropdown elevation share React's hover/shadow tokens. The Vue toolbar buttons, dropdown triggers, menu items, and steppers now reference the same shadcn `foreground`/`muted-foreground`/`muted`/`border` tokens React uses (previously the `--doc-*` family), so the toolbar matches React in both light and dark mode; the dropdown triggers also render at React's normal weight (they previously looked bold), and the selected menu item uses React's grey highlight instead of an indigo tint.
- b8011f8: Focus the Vue editor on load so you can start typing immediately, without first clicking into the page. Matches the React adapter.
- 7fe09f0: More React parity for the Vue editor: clicking the empty sidebar background now collapses an expanded comment/tracked-change card (it previously stayed open); the zoom control offers the same 50%–200% range and presets as React (was 25%–400%); and the toolbar dropdown triggers expose `aria-haspopup`/`aria-expanded` for screen readers.
- 7fe09f0: Ship Tailwind utility classes in the Vue package's `styles.css`. The Vue build now runs Tailwind (via its own `tailwind.config.js` + PostCSS), so utility classes used by components like `Button` and `Toolbar` are styled out of the box for consumers who import `@eigenpal/docx-editor-vue/styles.css`, without needing their own Tailwind config. Fixes #594.
- 7fe09f0: The Vue toolbar's paragraph-style picker now reflects the loaded document's real styles (names and order) instead of a fixed preset list, matching React's behaviour (e.g. it shows the document's "Normal" style name). Falls back to the built-in presets when a document has no styles. Also aligns the toolbar's font-size box border and active-button colour exactly with React.
- 7fe09f0: Bring the Vue toolbar's visual styling closer to React: toolbar controls now use the inherited system font (instead of the browser default Arial), the dropdown menus match React's border/radius/shadow, and the style-picker dropdown no longer balloons in width (the per-style preview is applied to an inner span and the menu is width-capped). Also extracts the font-size and style-option logic into composables to keep Toolbar.vue maintainable.
- 7fe09f0: Polish the Vue toolbar and comment cards to match React. The toolbar font-size box is now correctly editable (typing commits on Enter/blur; +/− and arrow steppers no longer revert; the preset dropdown opens positioned), is the same height as React's, and steps by 1 beyond the preset list; the style-picker dropdown previews match React's sizes/weights and the menu is the same compact width instead of ballooning. Comment and tracked-change cards now use the shared near-white card color and drop shadow (new `--doc-card`/`--doc-card-shadow` tokens, sourced once in core) in both collapsed and expanded states, instead of a blue tint and a divergent shadow, matching React.

  Further menu and submenu parity with React: the top menu bar (File/Format/Insert/Help) items and triggers use full-strength text instead of muted grey, with matching shortcut hints and submenu borders; the style dropdown no longer clips its last entries; font-picker group labels render Title Case; the alignment control is now a horizontal icon strip with a blue active state (matching React's AlignmentButtons) instead of a vertical labeled menu; and the comments sidebar width matches React (340px).

- Updated dependencies [a6a2dd0]
- Updated dependencies [931931a]
- Updated dependencies [fa3383b]
- Updated dependencies [32c5382]
- Updated dependencies [7fe09f0]
- Updated dependencies [7fe09f0]
- Updated dependencies [f50a3c7]
- Updated dependencies [7fe09f0]
  - @eigenpal/docx-editor-agents@1.6.0
  - @eigenpal/docx-editor-core@1.6.0
  - @eigenpal/docx-editor-i18n@1.6.0

## 1.5.0

### Minor Changes

- 19a25eb: Add `scrollToCommentId`, `scrollToChangeId`, and `highlightRange` methods to `DocxEditorRef` on both the React and Vue adapters, for revealing a location in the editor. Each scrolls the comment, tracked change, or position range into view and selects it so the selection overlay highlights the spot. `scrollToCommentId` and `scrollToChangeId` return `false` when the id no longer resolves, so callers can surface a "location no longer exists" affordance instead of silently doing nothing.

### Patch Changes

- ab38192: Support clickable inline Word checkbox content controls
- 37f79ad: Fix the Vue image selection frame being shifted right (misaligned) on platforms with classic scrollbars. The overlay now accounts for the inline-start scrollbar gutter reserved by `scrollbar-gutter: stable both-edges`.
- 5cdfa5c: Vue: fix the image selection frame appearing shifted off the image. Selecting an image right after a document loads measured the frame one frame before the page finished re-centering, stranding it to the side; the overlay now re-anchors across the layout settle (and across zoom transitions) so the frame keeps wrapping the image tightly. It also re-anchors when the comments sidebar slides the page sideways while an image stays selected, which previously left the frame stranded to the side until the next scroll.

  Fixes #764

- 5cdfa5c: Vue: insert images directly from Insert > Image like React — the OS file picker opens and the image is placed inline, fitted to the page width, with no intermediate dialog. This also fixes a tall empty gap that appeared below an inserted image wider than the page column. The read-file-fit-and-insert flow now lives in core (`insertImageFromFile`), so React and Vue share one code path and behave identically.
- d090d08: Fix Vue: replying to a tracked change now threads the reply under that suggestion instead of creating a top-level comment, and the sidebar re-stacks cards when one expands so an expanded card no longer overlaps the next. Fixes #773.
- Updated dependencies [7d02ec1]
- Updated dependencies [04130ef]
- Updated dependencies [ab38192]
- Updated dependencies [5cdfa5c]
- Updated dependencies [335ad6c]
- Updated dependencies [c5a4b1e]
- Updated dependencies [c4fd221]
- Updated dependencies [ca005c5]
- Updated dependencies [7d6daeb]
- Updated dependencies [5cdfa5c]
- Updated dependencies [44161e5]
  - @eigenpal/docx-editor-core@1.5.0
  - @eigenpal/docx-editor-agents@1.5.0
  - @eigenpal/docx-editor-i18n@1.5.0

## 1.4.0

### Minor Changes

- 1ab8b30: Image resize: drag a corner handle to scale (keeping aspect ratio) or an edge handle to stretch one side (width or height) and deliberately change the aspect ratio. Selection handles are now Word-style white dots. Inserted images keep their aspect ratio — a wide image dropped into a table cell or a narrow column now scales down to fit while staying in proportion, instead of squashing or overflowing the page. Fixes #266.

### Patch Changes

- 3d36236: Fix Vue `getDocument()` returning paragraphs without their `paraId`s until the first edit. The host Document cache is now synced with the ids assigned at load (#738), so `getDocument()` exposes them immediately. Fixes #746.
- 92690d6: Fix the Vue formatting toolbar not applying to a header or footer while editing it. Bold, italic, font, size, color, paragraph style, and clear-formatting now target the header/footer being edited instead of the document body. Fixes #749.
- Updated dependencies [28a521a]
- Updated dependencies [1ab8b30]
  - @eigenpal/docx-editor-core@1.4.0
  - @eigenpal/docx-editor-agents@1.4.0
  - @eigenpal/docx-editor-i18n@1.4.0

## 1.3.3

### Patch Changes

- bd704e2: Assign every paragraph a stable id when a document is opened, so block ids and `getSelectionInfo().paraId` work before the first edit. Previously a document without `w14:paraId` had null ids until you typed or added a comment. Fixes #738.
- bf42c14: Fix the Vue editor's text caret disappearing or jumping to the wrong place while typing. The caret/selection overlay now repaints through the layout gate (after the page repaints) instead of synchronously against stale DOM, so the caret stays visible and follows the insertion point. Fixes #736.
- Updated dependencies [bf748c0]
- Updated dependencies [15d4f39]
- Updated dependencies [06fa96b]
- Updated dependencies [bd704e2]
- Updated dependencies [30df527]
  - @eigenpal/docx-editor-core@1.3.3
  - @eigenpal/docx-editor-agents@1.3.3
  - @eigenpal/docx-editor-i18n@1.3.3

## 1.3.2

### Patch Changes

- b05e9cf: Add the `author` prop to the Vue editor, matching React. Comments and tracked changes created through the UI now use the supplied author name instead of always being attributed to "User". Fixes #720.
- 1c254e8: Add React-parity callback props to the Vue editor: `onChange`, `onError`, `onSelectionChange`, `onEditorViewReady`, and the comment lifecycle callbacks `onCommentAdd`, `onCommentResolve`, `onCommentDelete`, `onCommentReply`, and `onCommentsChange`. Hosts can now observe document, selection, and comment changes via props alongside the existing Vue events. Part of #720.
- 6228132: Vue toolbar tooltips and the right-click text context menu now follow the active i18n locale instead of always rendering English. Shortcut-bearing buttons (bold, italic, underline, insert link, super/subscript, image properties) and every context-menu item (cut, copy, paste, delete, select all, table and image actions) route through `t()`.
- Updated dependencies [3bd7bf7]
- Updated dependencies [0ded2a1]
- Updated dependencies [58e3a7e]
  - @eigenpal/docx-editor-core@1.3.2
  - @eigenpal/docx-editor-agents@1.3.2
  - @eigenpal/docx-editor-i18n@1.3.2

## 1.3.1

### Patch Changes

- 3fe9c57: Share the layout pipeline across the React and Vue adapters. The Vue editor now renders multi-column section layouts with correct per-section column widths, coalesces a burst of keystrokes into one layout pass per frame, and no longer scrolls the page when you edit. React behavior is unchanged.
- d100115: Fix blank render on documents whose header contains a page-anchored letterhead. The body now clears the header/footer based on in-flow content only, so anchored shapes and text boxes (which Word positions on the page) no longer push the body off the page. Fixes #705.
- 66cf3a8: Share the React/Vue editor orchestration through core so both adapters stay in lockstep. Vue gains three behaviors it was missing: multi-cell selection highlighting, drag-to-edge auto-scroll while selecting, and correct comment/tracked-change ID allocation (IDs are no longer reused after a delete and no longer collide across the comment/revision space). Vue selection rectangles now also cover tab stops and hyperlink text. No public API changes.
- Updated dependencies [3fe9c57]
- Updated dependencies [d100115]
- Updated dependencies [db75f4f]
- Updated dependencies [66cf3a8]
  - @eigenpal/docx-editor-core@1.3.1
  - @eigenpal/docx-editor-agents@1.3.1
  - @eigenpal/docx-editor-i18n@1.3.1

## 1.3.0

### Minor Changes

- 0f3eb97: Add the Insert → Watermark dialog to the Vue editor. The Vue adapter could already render and round-trip watermarks from opened documents; now you can also add, edit, or remove text and picture watermarks from the UI, with the change participating in undo/redo.

### Patch Changes

- 928593b: Vue: show the hyperlink popup when clicking a link in a header or footer. The click handler now resolves against the active header/footer editor (matching the body and React behavior) instead of the body, and no longer ignores links whose URL is empty.

  Fixes #692

- 6dc5b50: Vue: fix the image selection frame being offset from the image at zoom levels other than 100%. The overlay lives in the unscaled scroll viewport, so it now positions at post-scale pixels and scales its border/handles with the zoom factor, wrapping the image tightly. It also re-anchors when the zoom transition settles.

  Fixes #695

- 98ae3e5: Vue: fix the text selection highlight and caret drifting away from the text at zoom levels other than 100%. The overlay rects are painted into the scaled pages container, so they are now divided by the zoom factor to land on the selected text.

  Fixes #693

- 9c8068f: Fix the Vue "Add comment" card overlapping existing comment and tracked-change cards in the sidebar. The add-comment input now flows through the same collision-avoidance pass as every other card, so it claims its slot and neighbouring cards stack below it. Fixes #669
- cab7424: Fix the Vue header/footer "Remove" button doing nothing. Removing a header or footer now drops the part from the package and strips its section references, so it stops rendering on the page (matching React). Fixes #686
- f3d6861: Fix text selection not showing in Vue headers and footers. Selecting text while editing a header or footer now paints the highlight (the body overlay was suppressed in HF mode but the HF rects were never drawn), and double/triple-click word and paragraph selection resolves against the header/footer text instead of a body run at the same position. On multi-page documents, the caret and selection now render on the header/footer instance being edited rather than always on page one's copy. Fixes #691
- 06aea12: Vue: keep the image selection frame on the image when it moves to another page or is resized, instead of stranding it at the old position.
- 127985a: Fix the Vue horizontal ruler indent handles not tracking the active paragraph. The ruler now reads the selection's left/right/first-line/hanging indents and tab stops (like React) and moves the handles to match. Also stop showing an extra first-line-indent marker at the left margin. Fixes #685
- Updated dependencies [15966fc]
- Updated dependencies [2003cec]
- Updated dependencies [5e51a9b]
- Updated dependencies [cb5f622]
- Updated dependencies [1be9cf5]
- Updated dependencies [5fcca3b]
- Updated dependencies [f73706e]
- Updated dependencies [0d5beed]
- Updated dependencies [5b38696]
- Updated dependencies [15966fc]
- Updated dependencies [f3d6861]
- Updated dependencies [0f3eb97]
- Updated dependencies [eaa6f7f]
  - @eigenpal/docx-editor-core@1.3.0
  - @eigenpal/docx-editor-agents@1.3.0
  - @eigenpal/docx-editor-i18n@1.3.0

## 1.2.1

### Patch Changes

- Updated dependencies [a0adf60]
- Updated dependencies [1c2b098]
  - @eigenpal/docx-editor-agents@1.2.1
  - @eigenpal/docx-editor-core@1.2.1
  - @eigenpal/docx-editor-i18n@1.2.1

## 1.2.0

### Minor Changes

- 362a65f: Make block-level content controls (`w:sdt`) editable. Block structured document tags wrapping paragraphs or tables now convert to a dedicated ProseMirror node, so their content stays editable and the control survives the full edit cycle (previously it round-tripped on save but was flattened in the editor). The control boundary is drawn around its content in the paged view, and the region remains addressable by its tag/alias.
- d791e05: Add content-control (SDT) methods to the editor ref. `getContentControls` lists block controls in the live document (filtered by tag/alias/id/type) with their text and position; `scrollToContentControl` brings one into view; `setContentControlContent` fills a control by tag (as a normal undoable edit); `removeContentControl` deletes or unwraps one. Locked controls are refused unless forced. Paired across the React and Vue adapters.
- a60ed77: Add typed value setters for content controls. `setContentControlValue` (headless) and the `setContentControlValue` editor-ref method (React + Vue) set a dropdown selection, toggle a checkbox, or set a date by tag, updating both the visible content and the structured `w:sdtPr` state (dropdown `w:lastValue`, `w14:checked`, `w:date`'s `w:fullDate`). Validates the value against the control type and list items.
- a60ed77: Support repeating sections (`w15:repeatingSection`) with add/remove, matching Word. `addRepeatingSectionItem`/`removeRepeatingSectionItem` (headless) clone an item with fresh unique ids or drop one (keeping at least one); the editor renders ＋/✕ affordances on each repeating item in React and Vue. Items round-trip losslessly.

### Patch Changes

- Updated dependencies [362a65f]
- Updated dependencies [e30c763]
- Updated dependencies [d791e05]
- Updated dependencies [d791e05]
- Updated dependencies [a60ed77]
- Updated dependencies [bc67374]
- Updated dependencies [a60ed77]
  - @eigenpal/docx-editor-core@1.2.0
  - @eigenpal/docx-editor-agents@1.2.0
  - @eigenpal/docx-editor-i18n@1.2.0

## 1.1.0

### Minor Changes

- 9d7138e: Add a `fonts` prop on `<DocxEditor>` for declarative custom-font registration — each entry injects an `@font-face` from the URL you provide, and entries sharing a `family` register different weights. Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@eigenpal/docx-editor-core/utils`. Fixes #620.
- 9d7138e: Font-load failures now route through the React `onError` prop and the Vue `error` event instead of the console, so you can forward them to your own error tracker; with no subscriber attached they fall back to `console.warn`. Adds `onFontError(callback)` to `@eigenpal/docx-editor-core/utils` for non-adapter hosts.
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- Updated dependencies [14fe4f2]
- Updated dependencies [9d7138e]
- Updated dependencies [7e77654]
- Updated dependencies [bf11ee8]
- Updated dependencies [30c1931]
- Updated dependencies [9d7138e]
- Updated dependencies [7a91813]
- Updated dependencies [a7f9ac5]
- Updated dependencies [42ea72d]
- Updated dependencies [ebb85a5]
- Updated dependencies [137d5de]
- Updated dependencies [e5e0997]
  - @eigenpal/docx-editor-i18n@1.1.0
  - @eigenpal/docx-editor-core@1.1.0
  - @eigenpal/docx-editor-agents@1.1.0

## 1.0.3

### Patch Changes

- 6d56181: Vue now renders documents with stacked floating objects identically to React. Previously, the Vue composable ran a simplified measurement pipeline without floating-zone awareness, so anchored images / floating textboxes / floating tables would not push body text below them in Vue. The float-extraction and per-block orchestration is now shared from `@eigenpal/docx-editor-core/layout-bridge` (`measureBlocksWithFloats`); both adapters call it with their own per-block measure callback.
- Updated dependencies [24b31a4]
- Updated dependencies [ec36a50]
- Updated dependencies [143c31e]
- Updated dependencies [d91357e]
- Updated dependencies [bdd7f50]
- Updated dependencies [6d56181]
- Updated dependencies [e80093d]
  - @eigenpal/docx-editor-core@1.0.3
  - @eigenpal/docx-editor-agents@1.0.3
  - @eigenpal/docx-editor-i18n@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [4e73af5]
  - @eigenpal/docx-editor-core@1.0.2
  - @eigenpal/docx-editor-agents@1.0.2
  - @eigenpal/docx-editor-i18n@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [8d60d65]
- Updated dependencies [7806b78]
- Updated dependencies [a193caa]
- Updated dependencies [fe4cb94]
  - @eigenpal/docx-editor-core@1.0.1
  - @eigenpal/docx-editor-i18n@1.0.1
  - @eigenpal/docx-editor-agents@1.0.1

## 1.0.0

### Major Changes

- 6272b32: # 1.0.0

  First multi-package, multi-framework release. The monolithic `@eigenpal/docx-js-editor` is split into a framework-agnostic core and per-framework adapters, Vue 3 ships as a first-class adapter alongside React, and the license moves to Apache 2.0 across all packages.

  ## Package restructure (breaking)

  | Old import                                 | New import                                |
  | ------------------------------------------ | ----------------------------------------- |
  | `@eigenpal/docx-js-editor`                 | `@eigenpal/docx-editor-react`             |
  | `@eigenpal/docx-js-editor/react`           | `@eigenpal/docx-editor-react`             |
  | `@eigenpal/docx-editor-react/core`         | `@eigenpal/docx-editor-core`              |
  | `@eigenpal/docx-editor-react/headless`     | `@eigenpal/docx-editor-core/headless`     |
  | `@eigenpal/docx-editor-react/core-plugins` | `@eigenpal/docx-editor-core/core-plugins` |
  | `@eigenpal/docx-editor-react/mcp`          | `@eigenpal/docx-editor-agents/mcp`        |
  | `@eigenpal/docx-editor-react/i18n/*.json`  | `@eigenpal/docx-editor-i18n/*.json`       |

  The old `@eigenpal/docx-js-editor` package stays on 0.x for legacy maintenance — no 1.x compatibility shim ships. Framework-agnostic utilities (e.g. `createEmptyDocument`) move to core:

  ```diff
  - import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-js-editor';
  + import { DocxEditor } from '@eigenpal/docx-editor-react';
  + import { createEmptyDocument } from '@eigenpal/docx-editor-core';
  ```

  ## Vue 3 adapter (`@eigenpal/docx-editor-vue`)

  The Vue package becomes a real adapter (previously a stub). Public API mirrors React:
  - `<DocxEditor>` with matching prop surface
  - `useDocxEditor` composable + `renderAsync` for the Node.js path
  - `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles` subpaths

  Parity gates cover insert-table, find/replace, page-setup, context menus, image overlay (resize/move/rotate/aspect-locked corners, dimension tooltip), advanced cell/row options (margins, height rule, text direction, no-wrap), menu-bar icons + shortcuts + carets, toolbar pickers, and the agent UI surface.

  ## Shared i18n package (`@eigenpal/docx-editor-i18n`)

  Locale strings move out of `@eigenpal/docx-editor-react` into a dedicated package consumed by both adapters from a single source.

  ```diff
  - import de from '@eigenpal/docx-editor-react/i18n/de.json';
  + import de from '@eigenpal/docx-editor-i18n/de.json';
  ```

  The `defaultLocale` value (English) is still re-exported from the adapter packages, unchanged.

  ## Agent UI relocation (breaking)

  `AgentPanel`, `AgentChatLog`, `AgentComposer`, `AgentSuggestionChip`, `AgentTimeline` no longer ship from `@eigenpal/docx-editor-react`. They live at:
  - `@eigenpal/docx-editor-agents/react` — React components + `useAgentChat`
  - `@eigenpal/docx-editor-agents/vue` — Vue 3 twins, plus `AIContextMenu` and `AIResponsePreview`
  - `@eigenpal/docx-editor-agents/ai-sdk/react` / `/ai-sdk/vue` — `@ai-sdk/*` adapters
  - `@eigenpal/docx-editor-agents/bridge` — React-free `createEditorBridge`, `agentTools`, `executeToolCall`, `getToolSchemas`, `createReviewerBridge`. Safe for headless / Vue / Node.

  ```diff
  - import { AgentPanel, AgentChatLog } from '@eigenpal/docx-editor-react';
  + import { AgentPanel, AgentChatLog } from '@eigenpal/docx-editor-agents/react';
  ```

  The agent components no longer call `useTranslation` directly — pass localized `*Label` props instead. `<DocxEditor>`'s built-in agent panel slot still forwards localized strings automatically.

  Accessibility polish on the agent surface: keyboard-operable resize handle, Escape-dismissable context menu, live-region chat log, WCAG AA contrast on response previews.

  ## Toolbar naming unified (breaking)

  The standalone formatting bar is `Toolbar` on both adapters. The old "classic" single-row `Toolbar` (with File/Format/Insert menus baked in) is removed — compose `EditorToolbar.MenuBar` + `EditorToolbar.Toolbar` for that layout.

  | Old (React)                    | New (React + Vue)       |
  | ------------------------------ | ----------------------- |
  | `FormattingBar`                | `Toolbar`               |
  | Classic `Toolbar` (with menus) | `EditorToolbar`         |
  | `EditorToolbar.FormattingBar`  | `EditorToolbar.Toolbar` |

  Vue: `BasicToolbar` / `FormattingBar` aliases removed; `EditorToolbar`'s `formatting-bar` slot is now `toolbar`. Vue's table border-color and cell-fill pickers now use the advanced color picker matching React. Vue `MenuDropdown`'s `showChevron` default flips from `true` to `false` — pass `:show-chevron="true"` explicitly to keep the caret.

  ## `showPrintButton` prop removed (breaking)

  Removed from `<DocxEditor>` and `<Toolbar>` on both adapters; the Vue `<Toolbar>` `print` event is gone with it. `onPrint` callback stays.

  ```diff
  - <DocxEditor showPrintButton onPrint={handlePrint} />
  + <DocxEditor onPrint={handlePrint} />
  ```

  To hide File > Print, omit `onPrint`. Programmatic print still works via `ref.current.print()` / `editorRef.value.print()`.

  ## License moves to Apache 2.0

  All published packages relicense to Apache 2.0. Notably: `@eigenpal/docx-editor-agents` was AGPL-3.0-or-later — the relicense lifts copyleft obligations on agent embedders.

### Patch Changes

- 0187af2: Emit consumer-friendly JSON docs at `docs/json/<pkg-slug>/<subpath>.json` for every `@public` export across the published packages. Companion to the existing `etc/<slug>.api.md` snapshots — same source of truth (API Extractor), different output shape: instead of human-readable Markdown, the JSON is structured for a docs site to render any layout it wants. Includes per-export source-link URLs into the GitHub source tree, type-reference canonical IDs for cross-page linking, and TSDoc summaries/remarks/examples parsed out of the source.

  New tooling: `bun run docs:json` regenerates, `bun run docs:check` (in CI) fails on drift. Contract documented in `CLAUDE.md` under `### Docs JSON`. No runtime change to any published package.

- 348fa6b: API Extractor snapshots for the 6 published subpaths of `@eigenpal/docx-editor-react` (root, `/ui`, `/hooks`, `/dialogs`, `/plugin-api`, `/styles`) and `@eigenpal/docx-editor-vue` (root, `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles`). CI now fails on undocumented public-surface drift via `bun run api:check`.

  Adds `etc/parity.contract.json` — the cross-adapter parity contract listing which `DocxEditorProps` fields and `DocxEditorRef` members are paired between React and Vue, which are deliberately deferred in Vue, and which are Vue-exclusive. `bun run check:parity-contract` (also gated in CI) parses both snapshots and fails on any drift the contract doesn't acknowledge. Adding a new prop or ref method to either adapter forces an explicit classification in the contract.

  Vue composables now declare named `Use*Return` interfaces (`UseClipboardReturn`, `UseFindReplaceReturn`, `UseSelectionHighlightReturn`, `UseTableSelectionReturn`, `UseHistoryReturn`, `UseTableResizeReturn`, `UseDragAutoScrollReturn`, `UseVisualLineNavigationReturn`, `UseDocxEditorReturn`). Before this change the composables returned anonymous object literals that recursively expanded core's internal types in the published `.d.ts`, inflating `etc/composables.api.md` to 3,526 lines and locking core's internal `Run`/`Comment` shape into Vue's public contract. Named returns drop the snapshot to ~450 lines and decouple Vue's surface from core's internals.

  Vue's `useTableSelection` no longer exposes `manager: TableSelectionManager` in its return — it was unused by any internal consumer and leaked core's `TableSelectionManager` class as part of Vue's public surface.

  Side effect for `@eigenpal/docx-editor-vue`: the build no longer writes workspace-relative source paths (e.g. `../../core/src/core.ts`) into published declarations. Those paths were valid in this repo but unresolvable once installed from npm; setting `pathsToAliases: false` on the dts plugin keeps the package names (`@eigenpal/docx-editor-core`, `@eigenpal/docx-editor-i18n`) intact in `dist/*.d.ts`.

  No runtime change for either package.

- 2e6398a: Drop framework-prefixed names from Vue's public surface — the package name already encodes the framework, so `Vue`-prefixed identifiers are redundant in consumer code.

  Renames `VueRenderAsyncOptions` → `RenderAsyncOptions` in `packages/vue/src/renderAsync.ts`. The previous compat alias (`VueRenderAsyncOptions as RenderAsyncOptions`) is dropped — `RenderAsyncOptions` is now the only exported name. Matches React's `RenderAsyncOptions` 1:1.

  Adds `EditorPlugin` as a type alias for `VueEditorPlugin` in `packages/vue/src/plugin-api/types.ts`, mirroring React's `EditorPlugin` / `ReactEditorPlugin` pair. Consumers writing `import { EditorPlugin } from '@eigenpal/docx-editor-vue/plugin-api'` now resolve. `VueEditorPlugin` stays exported for callers who want the framework-explicit name.

  No runtime change.

- Updated dependencies [6272b32]
- Updated dependencies [c5125ff]
- Updated dependencies [76093f9]
- Updated dependencies [c5125ff]
- Updated dependencies [348fa6b]
- Updated dependencies [0187af2]
- Updated dependencies [6b8f1fb]
- Updated dependencies [61983ca]
- Updated dependencies [f7b8dc7]
- Updated dependencies [b2230a3]
- Updated dependencies [8836214]
  - @eigenpal/docx-editor-core@1.0.0
  - @eigenpal/docx-editor-agents@1.0.0
  - @eigenpal/docx-editor-i18n@1.0.0
