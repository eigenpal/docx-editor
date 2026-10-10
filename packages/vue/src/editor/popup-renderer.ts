import {
  Fragment,
  h,
  type Component,
  type FunctionalComponent,
  type VNodeProps,
  type AllowedComponentProps,
  type ComponentCustomProps,
} from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';

/** A render callback for an automatically hosted popup. False disables the popup. @public */
export type DocxEditorPopup<P extends object> = false | ((props: P) => DocxEditorChildren | null);

/**
 * Adapt a Vue component to a popup renderer while preserving its props and lifecycle.
 * Required and narrowed props remain checked; inherited framework attributes do not constrain the popup host.
 * @public
 */
export function definePopup<C extends Component | FunctionalComponent<never>>(
  component: C
): (
  props: C extends new (...args: never[]) => { $props: infer P }
    ? Omit<
        P,
        {
          [K in keyof P]-?: K extends keyof (VNodeProps &
            AllowedComponentProps &
            ComponentCustomProps)
            ? {} extends Pick<P, K>
              ? (VNodeProps & AllowedComponentProps & ComponentCustomProps)[K] extends P[K]
                ? K
                : never
              : never
            : never;
        }[keyof P]
      >
    : C extends (props: infer P, ...args: never[]) => unknown
      ? P
      : never
) => DocxEditorChildren {
  return (props) => h(component as Component, props as Record<string, unknown>);
}

const sessionKeys = new WeakMap<object, number>();
let nextSessionKey = 0;

/** @internal Render popup callbacks with a separate component lifetime for each form session. */
export function renderPopup<P extends object>(
  popup: DocxEditorPopup<P>,
  props: NoInfer<P>,
  session?: object
): DocxEditorChildren | null {
  if (popup === false) return null;
  let key: number | undefined;
  if (session) {
    key = sessionKeys.get(session);
    if (key === undefined) {
      key = ++nextSessionKey;
      sessionKeys.set(session, key);
    }
  }
  const children = popup(props);
  return session ? h(Fragment, { key }, [children]) : children;
}
