/**
 * Slot and icon content in public component props.
 *
 * React hosts pass {@link https://react.dev/reference/react/ReactNode | ReactNode}.
 * Vue hosts pass {@link https://vuejs.org/api/utility-types.html#vnode | VNode}.
 *
 * The exported alias is intentionally `any` so cross-adapter API parity compares one
 * documented shape while each host keeps its native render tree at runtime.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DocxEditorChildren = any;
