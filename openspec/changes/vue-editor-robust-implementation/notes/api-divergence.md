# Vue API Divergence Notes

Updated after the `chore/vue-unstub-readiness-439` slice.

## Component Export

Vue now exports the editor under the adapter-neutral names `DocxEditor` and `DocxEditorRef`, matching React's public import shape.

## `<DocxEditor>` Props

Vue now accepts `externalPlugins?: Plugin[]` so ProseMirror plugins can mount through the same editor path as React. This is required for visible decoration forwarding and built-in plugin parity.

Vue also accepts the React-compatible `mode?: 'editing' | 'suggesting' | 'viewing'` prop. `viewing` maps to the same read-only editing guard used by the existing `readOnly` prop.

The following React host-customization props are now wired in Vue as well:

- `theme`
- `showZoomControl`
- `initialZoom`
- `disableFindReplaceShortcuts`
- `toolbarExtra`
- `className`
- `style`
- `showOutline`
- `showOutlineButton`
- `fontFamilies`
- `showPrintButton`
- `onPrint`
- `onModeChange`
- `renderLogo`
- `onDocumentNameChange`
- `documentNameEditable`
- `renderTitleBarRight`

Still divergent from React:

- No controlled comments props (`comments`, `onCommentsChange`) yet.
- No `agentPanel` prop yet; use `@eigenpal/docx-editor-agents/vue` components directly.
- No `externalContent` mode yet.
- No placeholder/loading render props, print options, copy/cut/paste callbacks, or margin-guide/ruler-unit props yet.

## Ref API

Implemented bridge-compatible keys:

- `getDocument`
- `getEditorRef`
- `addComment`
- `replyToComment`
- `resolveComment`
- `proposeChange`
- `scrollToParaId`
- `findInDocument`
- `getSelectionInfo`
- `getComments`
- `applyFormatting`
- `setParagraphStyle`
- `getPageContent`
- `getTotalPages`
- `getCurrentPage`
- `onContentChange`
- `onSelectionChange`

Vue-only/editor-local keys:

- `save`
- `focus`
- `destroy`

Still divergent from React's wider `DocxEditorRef`:

- `getAgent()` returns `null` in Vue because the Vue adapter does not own a
  React `DocumentAgent` instance; agent integration uses
  `createEditorBridge(ref, author)` directly.
- `save()` does not accept React's `{ selective }` option yet.
- `openPrintPreview()` maps to browser print in Vue; React has a richer print
  preview path.

## Composables

`useDocxEditor()` now exposes `editorState` alongside `editorView` so custom Vue UI can observe transaction state without reaching through the view.

`useAutoSave(document, options)` now accepts the React option surface: recovery callback, max age, enabled flag, save-on-change, and debounce delay.
