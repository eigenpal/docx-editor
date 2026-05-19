/**
 * @eigenpal/docx-editor-vue/composables
 *
 * Vue composables mirroring the React `hooks` subpath — history, table
 * selection, find/replace, autosave, clipboard, zoom, and the high-level
 * `useDocxEditor` host composable.
 *
 * @example
 * ```ts
 * import { useAutoSave, useFindReplace } from '@eigenpal/docx-editor-vue/composables';
 * ```
 *
 * @packageDocumentation
 * @public
 */

export * from './useAutoSave';
export * from './useClipboard';
export * from './useCommentSidebarItems';
export * from './useDocxEditor';
export * from './useDragAutoScroll';
export * from './useFindReplace';
export * from './useFixedDropdown';
export * from './useHistory';
export * from './useSelectionHighlight';
export * from './useTableResize';
export * from './useTableSelection';
export * from './useTrackedChanges';
export * from './useVisualLineNavigation';
export * from './useWheelZoom';
export * from './useZoom';
