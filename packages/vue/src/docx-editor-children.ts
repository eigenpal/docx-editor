import type { VNode } from 'vue';

/**
 * Slot and icon content in public component props.
 *
 * Vue hosts pass {@link VNode}. React hosts pass {@link https://react.dev/reference/react/ReactNode | ReactNode}
 * through the paired {@link DocxEditorChildren} alias in `@docx-editor.dev/react`.
 *
 * @public
 */
export type DocxEditorChildren = VNode;
