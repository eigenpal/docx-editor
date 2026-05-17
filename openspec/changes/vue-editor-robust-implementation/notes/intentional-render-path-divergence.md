# Intentional render-path divergence

Both adapters render the visible pages via `packages/core/src/layout-painter/`.
React's old PM-node render component wrappers were removed during the
source-tree parity cleanup, so Vue no longer needs matching omissions for
that dead render-component tree.

The remaining React-specific editor shell files are deliberate omissions:

- `packages/react/src/components/edit/EditableImage.tsx`
- `packages/react/src/paged-editor/OffscreenEditorHost.tsx`
- `packages/react/src/paged-editor/DecorationLayer.tsx`
- `packages/react/src/paged-editor/SelectionOverlay.tsx`
- `packages/react/src/paged-editor/ImageSelectionOverlay.tsx`
- `packages/react/src/paged-editor/PagedEditor.tsx`

## React-specific toolbar state extraction

- `packages/react/src/components/toolbarUtils.ts`

The bulk of this file (`extractFormattingState` + state-mutation
reducers) operates on React's `FormattingAction` discriminated union,
which is local to `Toolbar.tsx`. Vue's `BasicToolbar` reads the same
`TextFormatting` / `ParagraphFormatting` shapes directly from PM
marks/attrs and dispatches via PM commands — no parallel
`extractFormattingState` needed. The framework-agnostic bit (the
OOXML highlight color map + `mapHexToHighlightName`) was lifted to
`packages/core/src/utils/highlightColors.ts` and is re-exported by
both adapter `toolbarUtils.ts` files; only the React-coupled state
extractor stays.
