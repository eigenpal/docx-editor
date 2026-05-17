// Vue mirror of packages/react/src/components/toolbarUtils.ts —
// only the framework-agnostic exports (highlight color map +
// helpers). The React-side `extractFormattingState` etc. depend on
// React's FormattingAction types and aren't portable; consumer
// plugins that need them should import from the React adapter.
export {
  HIGHLIGHT_HEX_TO_NAME,
  mapHexToHighlightName,
} from '@eigenpal/docx-editor-core/utils/highlightColors';
