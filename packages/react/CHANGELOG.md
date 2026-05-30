# @eigenpal/docx-js-editor

## 1.1.0

### Minor Changes

- 9d7138e: Add a `fonts` prop on `<DocxEditor>` for declarative custom-font registration — each entry injects an `@font-face` from the URL you provide, and entries sharing a `family` register different weights. Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@eigenpal/docx-editor-core/utils`. Fixes #620.
- 9d7138e: Font-load failures now route through the React `onError` prop and the Vue `error` event instead of the console, so you can forward them to your own error tracker; with no subscriber attached they fall back to `console.warn`. Adds `onFontError(callback)` to `@eigenpal/docx-editor-core/utils` for non-adapter hosts.
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- 371dbaf: Fix Find navigation in the paged editor: matches now map to live document positions, the page scrolls to the active match, and Enter advances through results instead of snapping back to the first. Fixes #321.
- 79c68b0: Fix hyperlink popup text and URL inputs being uneditable. The editor container's focus and keydown handlers were redirecting focus to the document, so the popup inputs could never hold focus or accept typing.
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

- 3e4b98e: Fix inline-image header lines to match Word. A line with a tall inline logo plus short text now baseline-aligns the label with the image bottom instead of centering it in an inflated line box, so it hugs the paragraph border. Inline images also honor their `wp:inline` distT/distB wrap distances, which previously only the block-image path applied.
- 0a93cc3: Internal: co-locate the Tailwind library config inside `packages/react/`. No runtime change.
- 6d56181: Vue now renders documents with stacked floating objects identically to React. Previously, the Vue composable ran a simplified measurement pipeline without floating-zone awareness, so anchored images / floating textboxes / floating tables would not push body text below them in Vue. The float-extraction and per-block orchestration is now shared from `@eigenpal/docx-editor-core/layout-bridge` (`measureBlocksWithFloats`); both adapters call it with their own per-block measure callback.
- e80093d: Body text now flows around stacked floating objects correctly. Documents with a side-anchored textbox plus an image floating to the right, or with a floating table whose width fills the page, used to render body paragraphs at full content width on top of the floats, push tables to the page top, or collapse the first paragraph to a single glyph per line. All three cases now match Word's layout.
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

- eb785dc: Fix `generateHexId` producing `w14:paraId` / `w14:textId` / comment `paraId` / `w16cid:durableId` values above their OOXML `ST_LongHexNumber` caps.

  `paraId` / `textId` are capped at `< 0x80000000`; `durableId` is capped at the stricter `< 0x7FFFFFFF`. Half of generated IDs previously landed in `[0x80000000, 0x100000000)` (paraId/textId/comment-paraId violations) and `0x7FFFFFFF` itself was also reachable (durableId violation). Word silently recovers these as "Document Recovery — Table Properties" on open and strict OOXML validators reject them.

  The generator now draws from `[0, 0x7FFFFFFE]` — the strictest bound across all consumers — so every ID is valid for every field that uses `generateHexId`.

- ba67554: Render PAGE/NUMPAGES/DATE field results with their own run formatting. The layout bridge dropped the field node's character marks, so a page number in a footer painted at the default font size and color instead of the footer run's.
- Updated dependencies [4e73af5]
  - @eigenpal/docx-editor-core@1.0.2
  - @eigenpal/docx-editor-agents@1.0.2
  - @eigenpal/docx-editor-i18n@1.0.2

## 1.0.1

### Patch Changes

- fe4cb94: Add per-locale subpath imports to `@eigenpal/docx-editor-i18n` so dynamic
  locale loading can code-split a single locale instead of bundling the whole
  set:

  ```ts
  // Static — bundler ships only this locale's strings
  import pl from '@eigenpal/docx-editor-i18n/pl';

  // Dynamic — splits into its own chunk, loaded on demand
  const pl = (await import('@eigenpal/docx-editor-i18n/pl')).default;
  ```

  Subpaths ship for every locale: `/en`, `/de`, `/he`, `/pl`, `/pt-BR`, `/tr`,
  `/zh-CN`. The named exports on the package root still work — pick the
  ergonomic path for static lists, the subpath for runtime locale switching.

  Also re-export `createEmptyDocument`, `createDocumentWithText`, and
  `CreateEmptyDocumentOptions` from `@eigenpal/docx-editor-react` and
  `@eigenpal/docx-editor-vue` so the common "spawn a blank editor"
  affordance no longer requires installing `-core` alongside the adapter.

  Surface `Comment`, `CommentRangeStart`, `CommentRangeEnd`,
  `TrackedChangeInfo`, `TrackedRunChange`, `Insertion`, `Deletion`,
  `MoveFrom`, `MoveTo`, and `ParagraphContent` from the main
  `@eigenpal/docx-editor-core` entry. They were already public via
  `@eigenpal/docx-editor-core/headless`; the main entry just hadn't been
  re-exporting them.

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

- fd1f9de: `@eigenpal/docx-editor-i18n` ships its public surface as named exports from the package root. One import path, IDE-discoverable, tree-shakeable.

  ```ts
  import {
    // Locale data — typed
    en,
    de,
    pl,
    tr,
    he,
    ptBR,
    zhCN,
    // Runtime lookup by BCP-47 tag
    locales,
    // Types
    type LocaleStrings,
    type Translations,
    type TranslationKey,
    type LocaleCode,
  } from '@eigenpal/docx-editor-i18n';
  ```

  `en` is typed as `LocaleStrings` (source of truth, 100% coverage). Every other locale is `PartialLocaleStrings` (null leaves fall back to English). Hyphenated locale codes use camelCase identifiers (`ptBR`, `zhCN`); the `locales` record keeps BCP-47 keys (`'pt-BR'`, `'zh-CN'`) for runtime lookup.

  The package is marked `sideEffects: false`, so importing one locale from the root tree-shakes the rest. Verified with esbuild: a consumer importing only `en` ships ~26KB.

  Breaking from earlier (unpublished) shape: the `./<locale>.json` subpath exports are gone. Everything goes through the root. The `LocaleStrings`, `Translations`, `PartialLocaleStrings`, and `TranslationKey` types are no longer re-exported from `-react` or `-vue`. Runtime exports from the adapters (`LocaleProvider`, `useTranslation`, `provideLocale`, `i18nPlugin`, `createTranslator`, `defaultLocale`) are unchanged.

### Patch Changes

- c395aa6: Render anchored DOCX text boxes with square text wrapping instead of converting them into standalone blocks.
- 0187af2: Emit consumer-friendly JSON docs at `docs/json/<pkg-slug>/<subpath>.json` for every `@public` export across the published packages. Companion to the existing `etc/<slug>.api.md` snapshots — same source of truth (API Extractor), different output shape: instead of human-readable Markdown, the JSON is structured for a docs site to render any layout it wants. Includes per-export source-link URLs into the GitHub source tree, type-reference canonical IDs for cross-page linking, and TSDoc summaries/remarks/examples parsed out of the source.

  New tooling: `bun run docs:json` regenerates, `bun run docs:check` (in CI) fails on drift. Contract documented in `CLAUDE.md` under `### Docs JSON`. No runtime change to any published package.

- 9d4d30e: Anchor hyperlink popup to its link on scroll; close Vue popup on outside click.
- 5d11c1a: Fix dense footnote rendering at page bottom
- bba58e4: Internal refactor: continue the DocxEditor.tsx cap effort. Extract the 432-LOC useImperativeHandle block into a useDocxEditorRefApi hook (preserves the dep array byte-for-byte so the editor-contract gate stays green). Pull the floating-overlay block (hyperlink popup, text + image context menus, toast container) into DocxEditorOverlays. Pull the lazy-loaded Suspense dialog block into DocxEditorDialogs — the lazy() import sites move with the JSX so the dialog code-split chunk is owned by the new component. Memoize the 60-line onSelectionChange closure on the PagedEditor mount. DocxEditor.tsx now 3724 → 3183 LOC. No public API change.
- 5a4ef95: Internal refactor: continue the DocxEditor.tsx cap effort, mirroring Vue's hook decomposition. Three more domain hooks extracted: useContextMenus (right-click text + image menus, contextMenuItems memo, handleContextMenuAction switch — comment-state writes routed through an onAddComment callback), useCommentManagement (controlled/uncontrolled comments routing, floating add-comment button position, new-comment workflow state, commentsRef mirror, orphaned-comments debouncer), and useCommentLifecycle (thread comments under overlapping tracked changes, auto-open sidebar on documents with existing tracked changes). DocxEditor.tsx 2634 → 2234 LOC. No public API change.
- cff5be4: Internal refactor: continue the DocxEditor.tsx cap effort by splitting the JSX render tree. Two new child components: DocxEditorToolbar (wraps the EditorToolbar with its 30+ props plus the title-bar slots and trailing extras) and DocxEditorPagedArea (PagedEditor mount, sidebar overlay, floating add-comment button, inline header/footer editor). DocxEditor.tsx 1972 → 1815 LOC. No public API change.
- 6ff5d22: Internal refactor: split DocxEditor.tsx (5158 → 3712 LOC, -28%) into focused hooks under `components/DocxEditor/hooks/` — useOutlineSidebar, useKeyboardShortcuts, useFileIO, usePageSetupControls, useHyperlinkActions, useFindReplaceBridge, useFormattingActions, useImageActions — plus 6 micro-components (CommentsSidebarToggle, LocalizedAgentPanel, PageIndicator, AgentPanelToggle, OutlineToggleButton, EditingModeDropdown) and a `commentFactories` module that hides the shared comment/revision ID counter behind getNextCommentId/bumpNextCommentIdAbove helpers. No public API change.
- 999a48d: Internal refactor: split PagedEditor.tsx (3230 → 775 LOC) into focused hooks under `components/DocxEditor/hooks/` — useLayoutPipeline, useSelectionOverlay, useImageInteractions, usePagedScrollApi, usePagesPointer, usePagedEditorRefApi, useLayoutTriggers — plus pure helpers domSelection.ts + tableResize.ts. No public API change.
- 348fa6b: API Extractor snapshots for the 6 published subpaths of `@eigenpal/docx-editor-react` (root, `/ui`, `/hooks`, `/dialogs`, `/plugin-api`, `/styles`) and `@eigenpal/docx-editor-vue` (root, `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles`). CI now fails on undocumented public-surface drift via `bun run api:check`.

  Adds `etc/parity.contract.json` — the cross-adapter parity contract listing which `DocxEditorProps` fields and `DocxEditorRef` members are paired between React and Vue, which are deliberately deferred in Vue, and which are Vue-exclusive. `bun run check:parity-contract` (also gated in CI) parses both snapshots and fails on any drift the contract doesn't acknowledge. Adding a new prop or ref method to either adapter forces an explicit classification in the contract.

  Vue composables now declare named `Use*Return` interfaces (`UseClipboardReturn`, `UseFindReplaceReturn`, `UseSelectionHighlightReturn`, `UseTableSelectionReturn`, `UseHistoryReturn`, `UseTableResizeReturn`, `UseDragAutoScrollReturn`, `UseVisualLineNavigationReturn`, `UseDocxEditorReturn`). Before this change the composables returned anonymous object literals that recursively expanded core's internal types in the published `.d.ts`, inflating `etc/composables.api.md` to 3,526 lines and locking core's internal `Run`/`Comment` shape into Vue's public contract. Named returns drop the snapshot to ~450 lines and decouple Vue's surface from core's internals.

  Vue's `useTableSelection` no longer exposes `manager: TableSelectionManager` in its return — it was unused by any internal consumer and leaked core's `TableSelectionManager` class as part of Vue's public surface.

  Side effect for `@eigenpal/docx-editor-vue`: the build no longer writes workspace-relative source paths (e.g. `../../core/src/core.ts`) into published declarations. Those paths were valid in this repo but unresolvable once installed from npm; setting `pathsToAliases: false` on the dts plugin keeps the package names (`@eigenpal/docx-editor-core`, `@eigenpal/docx-editor-i18n`) intact in `dist/*.d.ts`.

  No runtime change for either package.

- 29f9575: Preserve fields, nested SDTs, and math inside `<w:sdt>` content controls so docProps-bound titles wrapped in SDT render correctly.
- 491ec9a: Preserve fields, nested SDTs, and math inside inline SDT content on save. Completes #482 by mirroring its parser-side widening in the serializer and PM → Document converter so docProps-bound title fields survive a full load → edit → save round-trip.
- 5a30387: Inherit header/footer references and titlePg from earlier sections per ECMA-376 §17.6. Fixes templates that set these on the cover sectPr only.
- 7c3f2e1: Internal Vue refactor: extract `useImageActions`, `useContextMenus`, `usePagesPointer`, `useSelectionSync`, and `useDocxEditorRefApi` composables from `DocxEditorVue.vue`. No public API change.
- 9233c6e: Internal: `DocxEditorVue.vue` now under the 1000-LOC cap (897). Split template into `DocxEditorMenuBar`, `DocxEditorDialogs`, `DocxEditorOverlays`; extracted `useMenuActions`, `useCommentLifecycle`, `useDocumentLifecycle` composables; moved styles to a co-located `.css` file. No public-API change.
- 372cab6: vue: internal source restructure for React parity — `DocxEditorVue.vue` → `DocxEditor.vue`, root-level `docx-editor-props.ts` / `editor-mode.ts` / `editor-ref.ts` consolidated into `components/DocxEditor/types.ts`, orchestration files nested under `components/DocxEditor/`. No public API change.
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

## 0.5.1

### Patch Changes

- f7a1060: Fix header/footer table parity issues in paged render and inline editing, including header recreation after removal.
- cbff36e: Resolve themed table-cell border colors (`w:themeColor`) against the document theme so they render correctly in the inline header/footer editor and copied HTML, instead of falling back to the default Office palette.
- 2158433: Add Turkish (tr) translation with 100% coverage.

## 0.5.0

### Minor Changes

- 5fddb75: Image layout modes (Word-style): right-click image menu and toolbar dropdown now share five directional options (In Line with Text · Square Left · Square Right · Behind Text · In Front of Text) plus Cut/Copy/Paste/Delete. Inline ↔ anchor transitions promote inline images to anchored floats at the same rendered position (Word's behavior) and back, with full OOXML round-trip. Layout helpers (`pointerHitResolveImage`, `captureInlinePositionEmu`, `deriveLayoutChoice`, `IMAGE_LAYOUT_OPTIONS`, `toolbarValueToLayoutTarget`) are exported from `@eigenpal/docx-core/layout-painter` so framework adapters share them.
- c605277: Close 16 OOXML rendering gaps from the post-PR-#421 audit (#423): vertical anchor `align`, the six unhandled `relativeFrom` variants, bare `wp:positionH/V`, image crop (`wp:srcRect`), transparency (`a:alphaModFix`), `wp:effectExtent` shadow padding, rotation pivot, `layoutInCell` / `allowOverlap` round-trip, `w:vanish` / `w:rtl` / `w:effect` per-run, `w:trHeight hRule="exact"` enforcement, and `w:noWrap` on cells. `w:framePr` and `w:cols`-with-anchored-images are preserved on round-trip; visual rendering of those is left as a documented follow-up.

### Patch Changes

- aefb8c6: Serialize all integer-typed OOXML attributes (EMU and twips) as integers. Floating-point drift from arithmetic like `inches * 1440` (e.g. `0.7 * 1440 === 1008.0000000000001`) or `(px / 96) * 914400` (e.g. `cy="495299.99999999994"`) caused saved files to fail to open in Microsoft Word, even though tolerant readers accepted them. (fixes #417)

  Behavior changes for callers:
  - `pixelsToEmu`, `twipsToEmu`, and `emuToTwips` now round their result to the nearest integer. Previously they could return values like `495299.99999999994`.
  - `createEmptyDocument` rounds `pageWidth`, `pageHeight`, and all `margin*` options to integer twips at the API boundary.
  - `InsertImageCommand` (`agent.insertImage`) now correctly converts `width` / `height` from pixels to EMU. Previously it multiplied pixels by 914400 instead of 9525, producing images 96× the requested size (a 100 px image became a 96-inch image). Default 100 px now produces a ~1.04-inch image, matching the documented behavior.

  Defensive: every integer-typed XML attribute in the document, paragraph, table, and run serializers now coerces its value to an integer at write time, so fractional values reaching the serializer through any code path can no longer corrupt the saved file.

- b6c26db: Render `wp:wrapNone` anchored images (`behind` / `inFront`) as positioned floats instead of block images. They no longer consume paragraph flow height or create text-wrap exclusion zones, matching Word's behavior.

## 0.4.3

### Patch Changes

- 5fd14f9: Fix selection highlights bleeding from body into headers and footers. When body and header content shared low PM positions (because each is parsed as a separate ProseMirror document), the DOM-based selection painter matched both trees and drew phantom rectangles on every header and footer. Selection rectangles and caret lookups are now scoped to `.layout-page-content`.
- 11abc2d: Four header/footer fidelity follow-ups from the unification refactor:
  - **#379** — `RenderContext.positioning` controls renderer outer position. `paintTableFragment` and `paintParagraphFragment` now pick `position: absolute` vs `position: relative` based on context, so HF / textbox callers don't have to flip inline styles after the fact. Removes the post-render `style.position` flips at three call sites.
  - **#380** — Inline-vs-inherited paragraph spacing strip. `normalizeHeaderFooterMeasureBlocks` now strips `spaceBefore` / `spaceAfter` ONLY when they were resolved from a paragraph style (e.g. Normal's default 8pt-after) and not specified inline on the HF paragraph itself. Inline `<w:spacing>` is preserved per ECMA-376 §17.3.1.33; previously the blanket strip collapsed intentional Word spacing.
  - **#381** — Trailing empty paragraph after a table renders at zero height. OOXML requires a trailing block-level element after the last `<w:tbl>` (the canonical convention is an empty `<w:p/>`). Word renders that paragraph as a zero-height anchor; we previously added `~14pt` of phantom space. The new `suppressEmptyParagraphHeight` flag on `ParagraphAttrs` opts the empty paragraph out of the default empty-line height fallback during measurement, while keeping the block itself for click-to-position.
  - **#382** — Floating tables (`<w:tblpPr>`) honor `tblpX` / `tblpY` in headers/footers. New `resolveHeaderFooterFloatingTablePosition` resolves the anchor (`page` / `margin` / `text`) per ECMA-376 §17.4.57 and positions the table at the requested coordinates instead of inline at `cursorY`. Floating tables don't advance `cursorY` — surrounding HF blocks flow as if the table weren't there, matching Word's no-wrap behavior.

  `normalizeHeaderFooterMeasureBlocks` extracted into its own file to enable unit testing.

  Closes #379, #380, #381, #382.

- 0d3581d: Set package homepage to https://docx-editor.dev/.
- 4e194d7: Inline images in table cells now have visual breathing room. Previously when an image was taller than the parent paragraph's text line height, the line height was overwritten with the bare image height — so an image alone in a table cell rendered flush with the cell borders. Word treats an inline image as a tall glyph sitting on the text baseline: the image extends above the baseline (full ascent) and the line still reserves the parent font's normal descent + leading below. The line now grows to image-height + text-line-height, giving cells natural padding around image-dominant lines.
- e12c337: Footnote rendering now routes through the body pipeline (`footnoteToProseDoc → buildBoxTree → measureBlocks`), eliminating the shadow stack in `footnoteLayout.ts`. Footnotes inherit the full block-kind support of the body — paragraph, table, image, textBox, fields. Pre-PR a footnote that contained a table silently dropped the table; same for inline images and PAGE/NUMPAGES fields.

  The fix mirrors the header/footer unification (#356/#357/#358):
  - **Parser:** `parseFootnote` and `parseEndnote` now walk all child blocks (`<w:p>` + `<w:tbl>`) in document order. The `Footnote.content` and `Endnote.content` types widen from `Paragraph[]` to `(Paragraph | Table)[]` to match the body / HeaderFooter / TableCell shape and reflect ECMA-376 §17.11.10.
  - **Converter:** new `footnoteToProseDoc` next to `headerFooterToProseDoc`; takes `(Paragraph | Table)[]` and produces a PM doc using the same `convertParagraphWithTextBoxes` / `convertTable` machinery the body uses.
  - **Render adapter:** `convertFootnoteToContent` and `buildFootnoteContentMap` move from `core/layout-bridge/footnoteLayout.ts` to `react/.../PagedEditor.tsx`, parallel to `convertHeaderFooterToContent`. Footnote-specific presentation (default 8pt font, prepended display number as superscript) lives as a small post-process layer (`applyFootnotePresentation`).
  - **Cleanup:** `footnoteLayout.ts` shrinks from 293 lines to ~80 — only the page-mapping helpers remain (`collectFootnoteRefs`, `mapFootnotesToPages`, `calculateFootnoteReservedHeights`).

  Refs #378.

- 4aee2e0: Consolidate body-scoped `data-doc-from` DOM lookups behind `collectBodySpans` / `findBodyEmptyRuns` / `findBodyPmAnchors` / `findBodyPmAnchor` helpers in `@eigenpal/docx-core/layout-bridge`. Removes the lingering risk that body-only operations (caret resolution, selection painting, scroll restore, image `NodeSelection` lookup, sidebar anchor positioning, visual-line navigation) accidentally match a header or footer run whose ProseMirror position collides with a body position. Same bug class as #391; this finishes the cleanup started in #406.
- 274d858: Run-level OOXML attributes that were already parsed and held as ProseMirror marks now reach the painted DOM. The layout-bridge's `extractRunFormatting` had no `case` arm for several run-level marks, so the visible renderer silently dropped them while the hidden ProseMirror `toDOM` rendered them correctly:
  - **`w:caps` (§17.3.2.4) — `allCaps`** — uppercase styling on heading runs is no longer lowercased.
  - **`w:smallCaps` (§17.3.2.32) — `smallCaps`** — small-caps styling reaches the painted DOM.
  - **`w:position` (§17.3.2.24)** — baseline shift in half-points now applies as `vertical-align`.
  - **`w:w` (§17.3.2.43)** — horizontal text scale (e.g. 90% tracking on branded templates) applies as a `transform: scaleX(...)` on an inline-block.
  - **`w:kern` (§17.3.2.18)** — kerning threshold gate enables `font-kerning: normal` when the run's font size is at or above the threshold.

  The four `w:position` / `w:w` / `w:kern` properties share a single PM mark (`characterSpacing`) with a multi-attribute container; previously only its `spacing` attribute was bridged, so the other three sat in the model unread.

  Refs #410.

  Also propagates the cosmetic-effect marks (`emboss`, `imprint`, `textShadow`, `textOutline`, `emphasisMark`) which were the same defect class — PM marks parsed correctly but the layout-bridge had no `case` arm, so painted runs lost the effect. Each maps to the same CSS recipe the hidden PM `toDOM` uses, so editable + painted views stay visually identical.

  Adjacent fix for #392: paragraph runs without an explicit `fontFamily` mark now inherit the paragraph's resolved style font (from the basedOn → docDefaults cascade) instead of falling back to the painter's hardcoded Calibri stack. Same mechanism applies to `fontSize` — runs that don't override fall through to the paragraph's resolved default. Closes the per-run side of the rFonts cascade gap from #412.

  Refs #410, #412, fixes #392.

- 7ff0b6f: Fix style-cascade gaps for runs without an explicit `<w:rStyle>` and tables without an explicit `<w:tblStyle>`. Per ECMA-376 §17.7.4.18, both should inherit from the document's default style of the same type (the one marked `w:default="1"`); pre-PR the default character style was skipped entirely (only docDefaults.rPr reached such runs), and the table-borders cascade was hardcoded to look up styleId `"TableGrid"` instead of the parsed default flag.
  - `StyleResolver.getDefaultCharacterStyle()` finds the default by `w:default="1"` flag (varies by language: "Default Paragraph Font", "FontePadrao", "Fontepargpadro", etc.).
  - `resolveRunStyle()` now applies the cascade `docDefaults.rPr → default character style → explicit character style`, matching the cellMargins / paragraph cascade pattern.
  - `resolveTextFormatting()` no longer short-circuits when a run has no `styleId` — it always consults the full cascade.
  - Table borders cascade replaces the hardcoded `getStyle('TableGrid')` with `getDefaultTableStyle()`, matching the cellMargins cascade and working for documents whose default table style has any styleId.

  5 new unit tests cover the default character style cascade and the `getDefaultCharacterStyle()` helper. All 449 core tests pass (was 445).

  Refs #412.

- 4e194d7: Three Word-fidelity fixes surfaced by the Metal Nobre "DC_Template_Descricao_Cargo" template:
  - **Inline images no longer overflow their containing line.** Browsers compute a non-integer height for `<img>` from the natural aspect ratio when only `width`/`height` attributes are set, which clipped images sized in EMU (e.g. wp:extent `1771650×278918` rounds to `186×29` px but the natural ratio gave `29.29` px). Width/height are now also pinned via inline style, and the inline-image vertical alignment is the default `baseline` rather than `middle` — `middle` adds half-x-height of parent-font leading and pushed the image past the bottom of any line sized to fit just the image (the typical "image alone in a table cell" case).
  - **Explicit `w:before` is honored on the first paragraph of a page/column.** The pageComposer was unconditionally zeroing `spaceBefore` whenever the cursor was at `topMargin`, which dropped Word-authored leading space (e.g. `w:before="1800"` on the title paragraph). Word 2013+ honors explicit before-spacing at the top of a page; trailing-spacing is already reset on new-page so applying it here does not carry spacing across page breaks.
  - **A hard `<w:br w:type="page"/>` in an otherwise-empty paragraph now forces a page break.** `paragraphHasPageBreak` previously required preceding visible content (relying on `renderedPageBreakBefore` to cover leading breaks), but that attr is informational only and not honored at layout, so an empty paragraph containing just a page-break run silently dropped the break.

## 0.4.2

### Patch Changes

- 4425996: Fix `apply_formatting` tool schema rejection by Gemini. The `marks.highlight` enum no longer contains an empty string, which Gemini's `GenerateContentRequest` rejects. Pass `"none"` to clear the highlight.
- 2442eb4: Fix footer overflowing into body content on documents with tracked-change footers (or any footer taller than the authored bottom margin). The auto-extend that pushes body content up to make room for an oversized footer was applied to the document-level fallback margins but not to per-section margins carried on section breaks. The layout engine prefers section-break margins, so the extension was getting overridden and the footer rendered on top of body text. Section-break and final-section margins now also extend.
- ff6dbe8: Fix header/footer interactions in the inline editor: toolbar now reflects table state when the cursor is in a header/footer table cell, right-click shows the table context menu, and the horizontal/vertical rulers stay above the inline HF editor on scroll instead of being painted over. Fixes #384, #385.
- 811bf2c: Fix layout for documents with mixed sections and complex tables. Fixes #319.
  - Documents that mix portrait and landscape sections render with each section's own page size, margins, and columns instead of forcing every page to the body default.
  - Paragraphs that follow `<w:lastRenderedPageBreak/>` (the marker Word writes when it lays out a doc) no longer collapse onto the previous page on first load. The marker survives save+reload at its original position.
  - A section break immediately followed by a `pageBreakBefore` paragraph (e.g. an "Attachment" heading after a section change) no longer leaves a blank page between the body and the heading.
  - Tables with auto-fit grids, zero-width grid columns, or sparse single-cell rows render with correct column widths instead of collapsing or stretching.
  - Tables with vertically merged columns (`vMerge`) or explicit `gridSpan` no longer have continuation cells incorrectly expanded to span the full row.
  - A section override of only `marginRight` or `marginBottom` is now honored; unset sides inherit from the prior section instead of resetting to the OOXML 1440 default.
  - Paragraph spacing inside table cells is applied during measurement and rendering.
  - An oversized paragraph or image (taller than the page content area, possibly after a continuous section break to a smaller page size) is placed with overflow instead of hanging the pageComposer.

- a2f6342: Trim verbose comments and dead test scaffolding left over from #334.
- e32ebed: Fix list numbering when multiple `<w:num>` elements share one `<w:abstractNum>`. Per ECMA-376 §17.9.18 they share counter state and a `<w:lvlOverride>/<w:startOverride>` only resets the shared counter the first time its numId appears. Counter state is now keyed by abstractNumId; first-encounter resets are honored. Also fixes a related justification bug where list-level indents written with `<w:ind w:start="0"/>` were ignored, causing a 720-twip fallback indent to be applied and table-cell text to render 48px short of the cell width.
- 7a2665c: Fix font reset on save when a paragraph style explicitly sets `<w:rFonts ascii="Arial">` while document defaults supply a paired `asciiTheme="minorHAnsi"`. The OOXML render layer treats the theme attribute as overriding the explicit name, so a stale `asciiTheme` from `docDefaults` was silently turning Arial headings into Calibri. The font merge now treats explicit/theme attribute pairs as a unit per ECMA-376 §17.3.2.27. Fixes #387.
- f42ad91: Fix paragraph default font family resolution when a paragraph's pPr/rPr sets only one slot of `<w:rFonts>` (e.g. `w:eastAsia="Calibri"`). Previously the entire fontFamily object was replaced on merge, wiping out other slots inherited from the basedOn chain (e.g. `w:ascii="Arial Narrow"`). Per ECMA-376 §17.3.2.27, each ascii/hAnsi/eastAsia/cs slot — and its theme pair — must merge independently. Identical paragraphs now resolve to the same default font family and render at the same height.
- e89e859: Translate the floating page indicator (the "current of total" widget that appears next to the scrollbar while scrolling a multi-page document). It was rendering the literal string `" of "` regardless of the active locale. Fixes #399. New `viewer.pageIndicator` translation key (`"{current} of {total}"`) routes through the same `i18n` prop as the rest of the UI. Also fills in the four remaining `null` keys in `he.json` (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) so all six shipped locales (de, en, he, pl, pt-BR, zh-CN) are at 100% coverage.
- 5454bb2: Fix paragraph wrappers double-counting `spaceBefore`/`spaceAfter` in the renderer. The pageComposer already positions `fragment.y` with the gap baked in, but the renderer was also applying it as wrapper padding. Wrapper height is set to line-height only, so the padding pushed text below the wrapper bottom and the next paragraph's background covered the bottom half of the heading text. Symptom on real-world docs: top half of `Dev setup` heading missing — covered by the lavender background of the code block immediately following.
- 1259fa0: Unify header/footer rendering with the body pipeline. Header tables now render in the normal paginated view (previously they were silently dropped on the paginated render path while showing in edit mode), and headers/footers gain full block-kind support — paragraphs, tables, images, text boxes, and PAGE/NUMPAGES fields — by routing through the same `headerFooterToProseDoc → buildBoxTree → measureBlocks → paintFragment` chain the body uses. Fixes #356, #357, #358.
- f6703d0: Add Simplified Chinese (zh-CN) translation.

## 0.4.1

### Patch Changes

- bc02218: Fix long unbroken text overflowing page margins (#334). The page-level CSS default font (`Calibri, "Segoe UI", Arial, sans-serif`) didn't match the canvas measurement fallback (`Calibri, Carlito, ...`), so when Carlito loaded as a web font, line widths were measured against Carlito but rendered against Arial — causing strings like `asdfasdfasdf...` to extend past the right margin. Both sides now use the same `resolveFontFamily('Calibri')` chain.

## 0.4.0

### Minor Changes

- 159cad2: **Curated subpath exports + peerDeps move.** Replaces the `./*` wildcard on `@eigenpal/docx-core` with 17 explicit, tree-shakeable subpaths:
  - Top level: `.`, `./headless`, `./core-plugins`, `./mcp`
  - ProseMirror: `./prosemirror`, `./prosemirror/extensions`, `./prosemirror/conversion`, `./prosemirror/commands`, `./prosemirror/plugins`, `./prosemirror/editor.css`
  - DOCX I/O: `./docx`, `./docx/serializer`
  - Headless agent: `./agent`
  - Layout (`@experimental`): `./layout-engine`, `./layout-painter`, `./layout-bridge`, `./plugin-api`
  - Types: `./types/document`, `./types/content`, `./types/agentApi`
  - Utilities: `./utils`

  **Breaking change for consumers**: `prosemirror-*` packages are now `peerDependencies` (in both `@eigenpal/docx-core` and `@eigenpal/docx-js-editor`) so consumer bundles don't end up with duplicate ProseMirror copies. After upgrading you must install them yourself:

  ```bash
  npm i prosemirror-commands prosemirror-dropcursor prosemirror-history \
        prosemirror-keymap prosemirror-model prosemirror-state \
        prosemirror-tables prosemirror-transform prosemirror-view
  ```

  Also breaks the `schema → StarterKit → extensions → schema` circular import that crashed bundled consumers with `X is not a function`. Extensions now receive their owning `ExtensionManager` via `ExtensionContext.manager` instead of reaching for the module-level `singletonManager`. The `singletonManager` is no longer exported from `./prosemirror` — internal commands still get it via the relative `./schema` path inside the package.

### Patch Changes

- 23a2c7e: Add Hebrew (he) locale

## 0.3.1

### Patch Changes

- e92b349: Fix comments sidebar not repositioning when comments are added programmatically (e.g. via the agent `addComment` ref). Cards no longer overlap until you click one — heights are now re-measured whenever the items list changes, mirroring the existing re-measure pass that runs on expand/collapse.

## 0.3.0

### Minor Changes

- fe17e73: Add Open and Save entries to the toolbar's File menu (with Ctrl+O / Ctrl+S labels) so users can import and download DOCX files without leaving the editor. New translation keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) are wired through the i18n system and synced across community locales.

### Patch Changes

- 06cdf53: Agent now reads and searches the vanilla document. Previously, `read_document` showed insertions inlined and hid deletions (the resolved view), while the search backing `add_comment` / `suggest_change` flattened both — so a phrase the agent picked from `read_document` often failed to anchor and the bridge returned `null` with no diagnostic. Now both the read view and the search view treat the document as it exists right now: tracked insertions are hidden (not in the doc until accepted) and tracked deletions are visible as plain text (still in the doc until accepted). Anchoring against text the agent actually saw works on first try.
- beee9a4: Translate agent panel UI strings — wires `AgentPanel`, `AgentChatLog`, `AgentTimeline`, and `AgentComposer` through `t()` and ships full translations for `de`, `pl`, and `pt-BR`. Previously `agentPanel.*` keys were `null` in every non-English locale, and the chat primitives hardcoded strings like "Working… N steps", "Assistant is thinking", "Ask the assistant…", "Send", and "Resize agent panel".
- 69f5ab0: Translate the four File-menu keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) in `de.json`, `pl.json`, and `pt-BR.json` so German, Polish, and Brazilian-Portuguese users see localized labels instead of the English fallback. All three locales are now at 100% coverage.

## 0.2.0

### Minor Changes

- 6094eaf: Built-in agent panel + chat primitives + expanded toolkit so consumers can plug a streaming AI agent into the editor in ~50 lines. See [`docs/agents.md`](../docs/agents.md).

  ### Agent panel
  - `<DocxEditor agentPanel={{ render }}>` — controllable right-hand dock with toolbar toggle, drag-to-resize, persisted width, animated open/close. Render-prop receives `{ close }`; controlled mode (`open` + `onOpenChange`) lets a parent drive it.
  - New `agent-sparkle` icon and i18n keys across en / de / pl / pt-BR.

  ### Chat primitives (opinionated, optional)
  - `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>` — Google-Docs-style UI for message list, composer, starter chips, and a collapsible tool-call timeline (per-row spinner while streaming, auto-collapses to "N steps" on done).
  - New types: `AgentMessage`, `AgentToolCall`.

  ### Toolkit (`@eigenpal/docx-editor-agents`)
  - Four new tools: `apply_formatting`, `set_paragraph_style`, `read_page`, `read_pages`.
  - `useDocxAgentTools` hook with `include` / `exclude` filters; `executeToolCall` enforces them.
  - `AgentToolDefinition.displayName` for friendly UI labels.
  - New subpath exports — package stays runtime-agnostic, AI SDK helpers are opt-in:
    - `/server` — `getToolSchemas`, `executeToolCall`, `getToolDisplayName` (OpenAI function-calling format)
    - `/react` — `useDocxAgentTools`
    - `/ai-sdk/server` — `getAiSdkTools()` returning `streamText({ tools })` shape
    - `/ai-sdk/react` — `toAgentMessages()` adapting `useChat`'s `UIMessage[]` to `AgentMessage[]`
  - `WordCompatBridge` parity contract — compile-time assertion that `EditorBridge` covers `Range.font.*` and `ParagraphFormat.style`.

  ### Bug fixes
  - **Rapid sequential `addComment` calls now all persist.** The unified `setComments` setter read a stale `commentsRef.current` for every call; a 30-comment burst kept only the last. Now assigns `commentsRef.current` synchronously in uncontrolled mode.

  ### Spec / Word-API hardening
  - **`paraId` allocator** — new `ParaIdAllocatorExtension` assigns fresh 8-char hex `w14:paraId`s on Enter / paste / split. Without this the agent's anchors silently drifted whenever the user typed Enter. Marked `addToHistory: false`.
  - **`apply_formatting`** validates `underline.style` against ECMA-376 §17.3.2.40 `ST_Underline` and `highlight` against §17.3.2.15 `ST_HighlightColor`. Out-of-spec values return a structured error instead of round-tripping invalid OOXML.
  - **`set_paragraph_style`** returns `false` for ids not in `styles.xml` — matches Word's `ItemNotFound` behavior.

  ### Public API additions

  `@eigenpal/docx-js-editor`: `<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`, matching prop types, `AgentMessage`, `AgentToolCall`. `DocxEditorRef` gains `applyFormatting`, `setParagraphStyle`, `getPageContent`.

  `@eigenpal/docx-editor-agents`: new `/ai-sdk/server` and `/ai-sdk/react` subpaths (peer dep `ai`, optional). `/server` and `/react` unchanged. `displayName` on `AgentToolDefinition`.

  ### Known limitations (v1.1)
  - Missing Word `Range.font.*` properties: `superscript`, `subscript`, `allCaps`, `smallCaps`, `doubleStrikeThrough`, `colorTheme` tint/shade.
  - No paragraph-level mutators (`alignment`, `lineSpacing`, `spaceBefore`, `spaceAfter`) wired through the toolkit yet.

- 9c0721b: Add `disableFindReplaceShortcuts` to `DocxEditor` so host apps can let the browser handle native Cmd/Ctrl+F and Cmd/Ctrl+H shortcuts.
- c81fdd3: # Live agent chat + server-side MCP support

  A Word-API-style bridge that lets an AI agent read a DOCX, comment on it, suggest tracked changes, and scroll the view — live in a running editor, or server-side against a parsed file. Same tool catalog, same shape, two transports.

  ## The pattern

  Locate, then mutate. The agent calls a locate tool (`read_document`, `read_selection`, `find_text`) which returns paragraphs tagged with their stable Word `w14:paraId`. It passes those paraIds to mutate tools. paraIds survive concurrent edits and tool-loop iterations; ordinal indices don't.

  ## Ten agent tools

  OpenAI function-calling format (also accepted by Anthropic / Vercel AI SDK):
  - **Locate** — `read_document`, `read_selection`, `find_text`, `read_comments`, `read_changes`
  - **Mutate** — `add_comment`, `suggest_change` (one tool, three modes via empty-string semantics: replacement / deletion / insertion at paragraph end), `reply_comment`, `resolve_comment`
  - **Navigate** — `scroll`

  Exported from `@eigenpal/docx-editor-agents` as `agentTools`, `getToolSchemas()`, `executeToolCall(name, args, bridge)`.

  ## Two bridges, same interface

  Everything wires into an `EditorBridge` interface. Two implementations ship:

  ```ts
  // Live editor in a browser
  import { useAgentChat } from '@eigenpal/docx-editor-agents/bridge';
  const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'AI' });

  // Server-side, against a parsed DOCX
  import { DocxReviewer, createReviewerBridge } from '@eigenpal/docx-editor-agents';
  const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI');
  const bridge = createReviewerBridge(reviewer);
  const result = executeToolCall('add_comment', { paraId, text }, bridge);
  ```

  Both expose the same 10 tools to the agent. The bridge layer abstracts the transport.

  ## MCP server (built-in, spec 2025-06-18)

  ```ts
  import { McpServer, createReviewerBridge, DocxReviewer } from '@eigenpal/docx-editor-agents';
  import { McpServer as _ } from '@eigenpal/docx-editor-agents/mcp';

  const server = new McpServer(bridge, { name: 'my-saas', version: '1.0.0' });
  const reply = server.handle(jsonRpcMessage); // sync, transport-free, never throws
  ```

  - **Transport-agnostic core**: wire `server.handle()` to HTTP-SSE, WebSocket, your queue worker, or a managed stdio process. The library does not pick a transport.
  - **stdio adapter** for customers who want to run the server inside a worker pool: `runStdioServer(bridge)` (Node-only).
  - **Spec compliance**: `initialize` / `tools/list` / `tools/call` / `ping`. Tool failures use the spec's `{isError: true, content: [...]}` envelope inside a successful JSON-RPC response; JSON-RPC errors are reserved for protocol-level problems. Includes UTF-8-safe chunk decoding (multi-byte codepoints don't break across stdio chunks) and a buffer cap to prevent memory DoS.

  A local-install stdio bin was prototyped and removed: one-document-per-config is the wrong shape for a contract-review product. The right deployment is a hosted MCP service the customer operates with their own auth + storage.

  ## Events

  `bridge.onContentChange(listener)` and `bridge.onSelectionChange(listener)` (both return unsubscribe functions) let host apps and MCP servers react to edits without owning the single React callback prop.
  - `ContentChangeEvent` ships `{ commentCount, changeCount, comments, changes }`.
  - `SelectionChangeEvent` ships the current `SelectionInfo` or `null`. (Reviewer bridge: never fires — no caret in headless mode.)

  ## New on `DocxEditorRef`

  ```ts
  addComment({ paraId, text, author, search? }) → number | null
  replyToComment(commentId, text, author)        → number | null
  resolveComment(commentId)                       → void
  proposeChange({ paraId, search, replaceWith, author }) → boolean
  findInDocument(query, { caseSensitive?, limit? }) → FoundMatch[]
  getSelectionInfo()                              → SelectionInfo | null
  getComments()                                   → Comment[]
  onContentChange(listener)                       → () => void
  onSelectionChange(listener)                     → () => void
  ```

  `scrollToParaId` was already public.

  ## New on `@eigenpal/docx-core`

  `findParagraphByParaId(doc, paraId)` returns the PM range for a paragraph by paraId.

  ## Word JS API parity contract

  `WordCompatBridge` (exported type from the package root) formally documents every Office.js Word API method we mirror. A compile-time static assertion enforces that `EditorBridge` satisfies it. If we drop or change a method that's part of the public Word-API mirror, typecheck breaks.

  ## Demos
  - **`examples/agent-use-demo` (roast-my-doc)** — server-side demo of the canonical "build your own MCP-shaped agent server" pattern: parse → `createReviewerBridge` → `agentTools` → tool-call loop with `executeToolCall` → `toBuffer()`. The route's preamble shows the one-line diff to convert it to a real MCP server.
  - **`examples/agent-chat-demo` (chat with your doc)** — live editor + chat panel. Demonstrates `useAgentChat` against a running `<DocxEditor>`.

  Both demos support `ALLOWED_ORIGINS` env var for production deployments (open by default for local dev), forward client `AbortSignal` to OpenAI calls, and cap upload size.

  ## Hardening
  - `proposeChange` refuses to layer onto an existing tracked-change run (would produce invalid OOXML).
  - Ambiguous `search` arguments return an error instead of silently mistargeting.
  - `scroll` does not steal the user's caret.
  - Comment IDs and tracked-change revisionIds use the shared monotonic counter to avoid collisions in OOXML.
  - Mark guards if a host StarterKit omits `comment` / `insertion` / `deletion` extensions.

  ## Spec

  `specs/live-agent-chat.md`.

- 8dba7e8: # Word-style split button for text + highlight color (issue #130)

  Closes [#130](https://github.com/eigenpal/docx-editor/issues/130).

  The font-color and highlight-color toolbar buttons are now Word-style split buttons. Two halves:
  - **Apply half (icon + swatch):** click to re-apply the last color you picked. No dropdown.
  - **Arrow half (▾):** click to open the full color picker (theme grid, standard colors, custom hex, "no color").

  Pick a color once, then for every subsequent occurrence just click the swatch — one click instead of three.

  ## API surface (consolidated)

  The package previously shipped two color pickers — a simple `ColorPicker` and a fuller `AdvancedColorPicker`. The two have been merged into a single `ColorPicker` with two new props:
  - `splitButton?: boolean` — default `true`. Set `false` to render a legacy single-button shape.
  - `defaultColor?: ColorValue | string` — initial "last picked" color used by the apply half before the user picks anything. Defaults: text → red, highlight → yellow, border → black.

  The "last picked" memory is independent of the current selection's color (matches Word). Picking "Automatic" / "No color" does NOT update it.

  ## Breaking changes
  - The legacy `ColorPicker` (the simpler grid picker that ran inline, not via dropdown) has been **removed**. Its types `ColorOption` and the old `ColorPickerProps` shape are no longer exported.
  - `AdvancedColorPicker` has been **renamed to `ColorPicker`**. Update imports:

    ```diff
    - import { AdvancedColorPicker } from '@eigenpal/docx-js-editor';
    + import { ColorPicker } from '@eigenpal/docx-js-editor';
    ```

    The exported `ColorPickerProps` and `ColorPickerMode` types now correspond to the renamed component (formerly `AdvancedColorPickerProps` / `AdvancedColorPickerMode`).

  - CSS class names changed from `docx-advanced-color-picker-*` → `docx-color-picker-*`. If you targeted these in user CSS overrides, update the selectors.

  ## Migration

  No changes needed inside the library — text-color, highlight-color, table-cell-fill, and table-border-color buttons all use the new `ColorPicker` automatically. If you import `AdvancedColorPicker` directly, switch to `ColorPicker`. If you used the legacy simpler `ColorPicker`, the new `ColorPicker` is a drop-in for any case that benefits from the fuller picker; otherwise build a small custom picker — the legacy one was thin enough to inline.

### Patch Changes

- 71a1836: Replace hardcoded `816` page-width literals in `DocxEditor` with the existing
  `DEFAULT_PAGE_WIDTH` constant exported from `PagedEditor`, and fold the two
  duplicated `pageWidth` fallback expressions into a single `pageWidthPx` value
  shared by `UnifiedSidebar` and `CommentMarginMarkers`.
- f31fd5a: Fix document outline overlap and ruler behavior
  - Outline panel no longer sits on top of the page. On wide viewports the
    page stays where it was (centered, or translated left by the comments
    sidebar) — only the layout's min-width grows so the centered page never
    overlaps the panel. On narrow viewports the page + outline scroll
    horizontally as a unit instead.
  - Outline panel header lines up with the doc's top margin and uses a
    transparent background so the page's left-side shadow stays visible when
    the viewport is squeezed.
  - Vertical ruler stays pinned to the viewport's left edge during horizontal
    scroll instead of scrolling out of view.
  - Horizontal ruler is now sticky inside the scroll container, so it scrolls
    horizontally with the doc and stays put on vertical scroll. Padding tracks
    the outline (right shift) and comments sidebar (left shift) so the ruler
    centers against the same axis as the page.
  - Editor surround uses `--doc-bg` uniformly so the over-scroll/rubber-band
    area matches the gutter.

- 6a0b9a9: Fix crash when accepting a tracked replacement.

  The `paragraphChangeTracker` plugin walked `tr.steps` using each step's raw
  `from`/`to`/`pos` against `tr.doc` (the final doc after every step has been
  applied). Those coords are valid only in the doc as it was _when that step
  ran_, so a later doc-shrinking step could leave the earlier step's coords
  past the final doc end and crash `Fragment.nodesBetween` on
  `undefined.nodeSize`.

  Concretely: `acceptChange` emits `[RemoveMarkStep, ReplaceStep]` when the
  range contains both an `insertion` mark and a `deletion` (a tracked
  replace). The replace shrinks the doc, the mark step's `to` becomes
  invalid in `tr.doc`, and the editor crashes.

  Remap each step's coords through `tr.mapping.slice(stepIndex + 1)` before
  using them with `tr.doc`, and skip steps whose range was fully consumed by
  a later deletion. Adds a regression test reproducing the
  accept-tracked-replacement crash shape.

- 95f8df1: Add Brazilian Portuguese (pt-BR) locale support with 100% translation coverage.

  This PR introduces:
  - New `packages/react/i18n/pt-BR.json` file
  - 619 translated UI strings (100% coverage)
  - Proper locale structure following existing patterns
  - All keys in sync with en.json source

  The translation covers core UI elements including:
  - Common actions (cancel, save, edit, etc.)
  - Toolbar and formatting controls
  - Color picker and dialog interfaces
  - Table operations and context menus
  - Error messages and status indicators

## 0.1.1

### Patch Changes

- 1a9d8eb: Fix caret rendering at the wrong height after changing font size/family in an empty paragraph. The paragraph measurement cache key didn't include `defaultFontSize`/`defaultFontFamily`, so empty paragraphs with different default fonts collided on the same key and the cache returned a stale measurement until the user typed a character.
- 1a9d8eb: Fix font/size/color/highlight changes silently dropping when applied in an empty paragraph (e.g. right after pressing Enter). The mark commands set stored marks before updating the paragraph node, but every transform step clears stored marks — so the chosen value was wiped before dispatch and typed text fell back to the editor default. Reordered so node updates run first.
- 14d7623: ci(release): fix Slack notification release link to use per-package tag (changesets fixed-group ships @eigenpal/docx-js-editor@X.Y.Z, not vX.Y.Z)

## 0.1.0

### Minor Changes

- 91a6f97: Add `fontFamilies` prop to `DocxEditor` to customize the toolbar's font dropdown.

  Pass either bare strings or full `FontOption` objects (or a mix). Strings render in the "Other" group; `FontOption[]` enables CSS fallback chains and category grouping. Omitting the prop preserves the existing 12-font default. Closes #278.

  ```tsx
  <DocxEditor
    fontFamilies={[
      'Arial',
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
    ]}
  />
  ```

### Patch Changes

- b10a517: Fix three toolbar tooltips/labels that ignored the `i18n` prop and rendered as English regardless of locale: the comments-sidebar toggle, the outline-toggle button, and the Editing / Suggesting / Viewing mode dropdown (including its descriptions). The translation keys already existed in `de.json` and `pl.json`; the components were just bypassing `useTranslation()`. Now wired through correctly.

## 0.0.35

### Patch Changes

- bcc9c6d: Fix a regression where clicking the checkmark of a resolved comment did not re-open the comment card (issue #268). `PagedEditor.updateSelectionOverlay` fired `onSelectionChange` from every overlay redraw — including ResizeObserver and layout/font callbacks — not only on actual selection changes. When the sidebar card resize (or any window resize) triggered a redraw, the parent received a spurious callback with the unchanged cursor and cleared the just-set expansion. Dedup by PM state identity (immutable references) so consumers are only notified for real selection / doc / stored-marks changes.

  Also: cursor-based sidebar expansion now skips resolved comments. Moving the cursor through previously-commented text no longer re-opens old resolved threads — they stay collapsed to the checkmark marker until the user explicitly clicks it.

## 0.0.34

### Patch Changes

- ce89e70: Yjs collab

## 0.0.33

### Patch Changes

- Add i18n

## 0.0.32

### Patch Changes

- Fixes with comments and tracked changes

## 0.0.31

### Patch Changes

- [`d77716f`](https://github.com/eigenpal/docx-editor/commit/d77716f3abc8580ca48d9e2280f6564ce17df443) Thanks [@jedrazb](https://github.com/jedrazb)! - Bump

## 0.0.30

### Patch Changes

- Bump

## 0.0.29

### Patch Changes

- Bump to patch

## 0.0.28

### Patch Changes

- Bump packages
