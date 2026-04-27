# @eigenpal/docx-js-editor

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
