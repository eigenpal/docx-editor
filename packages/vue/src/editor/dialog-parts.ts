import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import {
  cloneVNode,
  defineComponent,
  h,
  inject,
  isVNode,
  provide,
  ref,
  shallowRef,
  watch,
  onBeforeUnmount,
  type DefineComponent,
  type CSSProperties,
  type InjectionKey,
  type PropType,
  type Ref,
  type VNode,
} from 'vue';
import { Slot } from './toolbar/Slot';
import { trapTabWithin } from './paragraph-dialog-fields';
import type { DocxEditorChildren } from '../docx-editor-children';
import { flattenChildren } from '../lib/flattenChildren';

/** Shared presentation props for dialog parts. @public */
export interface DialogPartProps {
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}
/** Layout customization for a packaged dialog. @public */
export interface DialogCustomizationProps {
  className?: string;
  style?: CSSProperties;
  preset?: boolean;
  children?: DocxEditorChildren;
}
/** Draft state and actions for a dialog. @public */
export interface UseDialogReturn<T extends object> {
  readonly values: Readonly<Ref<T>>;
  readonly errors: Readonly<Ref<Readonly<Partial<Record<keyof T | 'form', string>>>>>;
  readonly isEnabled: Readonly<Ref<boolean>>;
  setValue<K extends keyof T>(name: K, value: T[K]): void;
  apply(): void;
  cancel(): void;
}
const props = {
  className: String,
  style: Object as PropType<CSSProperties>,
  hidden: Boolean,
  asChild: Boolean,
};
interface Composition {
  defaults: Ref<Map<string, VNode>>;
  overrides: Map<string, VNode>;
}
export function createDialogComposition<
  T extends object,
  Name extends string = Extract<keyof T, string>,
>(
  name: string
): {
  parts: Record<
    'Header' | 'Title' | 'Body' | 'Footer' | 'Apply' | 'Cancel' | 'Error',
    DefineComponent<DialogPartProps>
  > & { Field: DefineComponent<DialogPartProps & { name: Name }> };
  useContext: () => UseDialogReturn<T>;
  provideContext: (
    context: UseDialogReturn<T>
  ) => (defaults: VNode, children: VNode[], preset: boolean) => VNode | VNode[];
} {
  const key: InjectionKey<UseDialogReturn<T>> = Symbol(name);
  const compositionKey: InjectionKey<Composition> = Symbol(`${name}.parts`);
  function useContext(): UseDialogReturn<T> {
    const value = inject(key);
    if (!value) throw new Error(`${name} parts must be rendered inside ${name}.`);
    return value;
  }
  function part(partName: string) {
    return Object.assign(
      defineComponent({
        name: `${name}${partName}`,
        inheritAttrs: false,
        props: {
          ...props,
          name: { type: String as unknown as PropType<Name>, default: undefined },
        },
        setup(p, { attrs, slots }) {
          const ctx = useContext();
          const composition = inject(compositionKey)!;
          return () => {
            if (p.hidden) return null;
            const id = partName === 'Field' ? `Field:${p.name}` : partName;
            const original = composition.defaults.value.get(id);
            const children = slots.default?.();
            const action =
              partName === 'Apply'
                ? { type: 'button', disabled: !ctx.isEnabled.value, onClick: ctx.apply }
                : partName === 'Cancel'
                  ? { type: 'button', onClick: ctx.cancel }
                  : {};
            const merged = {
              ...original?.props,
              ...attrs,
              ...action,
              class: [original?.props?.class, attrs.class, p.className],
              style: { ...original?.props?.style, ...p.style },
              'data-docx-part': partName.toLowerCase(),
              ...(p.name ? { 'data-docx-field': p.name } : {}),
            };
            if (p.asChild) return h(Slot, merged, { default: () => children });
            if (original) {
              const node = cloneVNode(original, merged);
              if (children) node.children = children;
              return node;
            }
            if (partName === 'Error' && !Object.keys(ctx.errors.value).length && !children)
              return null;
            return h(
              partName === 'Apply' || partName === 'Cancel'
                ? 'button'
                : partName === 'Title'
                  ? 'h2'
                  : 'div',
              { ...merged, ...(partName === 'Error' ? { role: 'alert' } : {}) },
              children ??
                (partName === 'Error' ? Object.values(ctx.errors.value).join(' ') : undefined)
            );
          };
        },
      }),
      { docxDialogPart: partName }
    );
  }
  const parts = {
    Header: part('Header'),
    Title: part('Title'),
    Body: part('Body'),
    Footer: part('Footer'),
    Apply: part('Apply'),
    Cancel: part('Cancel'),
    Error: part('Error'),
    Field: part('Field'),
  };
  function provideContext(context: UseDialogReturn<T>) {
    provide(key, context);
    const composition: Composition = { defaults: shallowRef(new Map()), overrides: new Map() };
    provide(compositionKey, composition);
    return (defaults: VNode, children: VNode[], preset: boolean): VNode | VNode[] => {
      const defaultsMap = new Map<string, VNode>();
      composition.overrides.clear();
      const extras: VNode[] = [];
      for (const child of flattenChildren(children)) {
        const marker = (child.type as { docxDialogPart?: string }).docxDialogPart;
        if (marker)
          composition.overrides.set(
            marker === 'Field' ? `Field:${child.props?.name}` : marker,
            child
          );
        else extras.push(child);
      }
      const flattenNodes = (nodes: unknown[]): unknown[] =>
        nodes.flatMap((node) => (Array.isArray(node) ? flattenNodes(node) : [node]));
      const visit = (node: VNode, replace: boolean): VNode => {
        const marker = node.props?.['data-docx-part'];
        const id =
          marker === 'field'
            ? `Field:${node.props?.['data-docx-field']}`
            : typeof marker === 'string'
              ? marker[0].toUpperCase() + marker.slice(1)
              : undefined;
        const copy = cloneVNode(node);
        if (Array.isArray(node.children))
          copy.children = flattenNodes(node.children).map((n) =>
            isVNode(n) ? visit(n, replace) : n
          ) as VNode['children'];
        if (id) {
          defaultsMap.set(id, copy);
          if (replace && composition.overrides.has(id)) return composition.overrides.get(id)!;
        }
        return copy;
      };
      const rendered = visit(defaults, preset);
      composition.defaults.value = defaultsMap;
      return preset ? [rendered, ...extras] : children;
    };
  }
  return {
    parts: parts as unknown as Record<
      'Header' | 'Title' | 'Body' | 'Footer' | 'Apply' | 'Cancel' | 'Error',
      DefineComponent<DialogPartProps>
    > & { Field: DefineComponent<DialogPartProps & { name: Name }> },
    useContext,
    provideContext,
  };
}
export const NativeDialog = defineComponent({
  name: 'DocxNativeDialog',
  inheritAttrs: false,
  props: {
    onClose: { type: Function as PropType<() => void>, required: true },
    label: { type: String, required: true },
    kind: { type: String, required: true },
    role: String,
    onKeydown: Function as PropType<(event: KeyboardEvent) => void>,
    dismissOutside: { type: Boolean, default: true },
    restoreFocus: { type: Boolean, default: true },
    sessionSignal: Object as PropType<AbortSignal>,
    content: Function as PropType<() => import('vue').VNodeChild>,
  },
  setup(p, { attrs, slots }) {
    const panel = ref<HTMLDialogElement>();
    const defaultScope = ref(false);
    let opener: HTMLElement | null = null;
    watch(
      [panel, () => p.sessionSignal],
      ([value, signal], _old, onCleanup) => {
        if (!value) return;
        defaultScope.value = !value.parentElement?.closest('.docx-editor');
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const abort = () => {
          if (value.open) value.close?.();
        };
        signal?.addEventListener('abort', abort, { once: true });
        onCleanup(() => signal?.removeEventListener('abort', abort));
        if (!value.open && typeof value.showModal === 'function') value.showModal();
        else value.setAttribute('open', '');
        (
          value.querySelector<HTMLElement>(
            'input:not([disabled]),select:not([disabled]),button:not([disabled])'
          ) ?? value
        ).focus({ preventScroll: true });
      },
      { flush: 'post' }
    );
    onBeforeUnmount(() => {
      if (panel.value?.open) panel.value.close?.();
      if (p.restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    });
    return () =>
      h(
        'dialog',
        {
          ...attrs,
          onKeydown: (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing || event.defaultPrevented) return;
            if (panel.value && trapTabWithin(panel.value, event)) {
              event.preventDefault();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              p.onClose();
            } else p.onKeydown?.(event);
          },
          ref: panel,
          role: p.role ?? 'dialog',
          'aria-modal': true,
          'aria-label': p.label,
          'data-docx-dialog': p.kind,
          class: ['docx-dialog', defaultScope.value ? 'docx-editor' : undefined, attrs.class],
          onCancel: (e: Event) => {
            e.preventDefault();
            p.onClose();
          },
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            if (p.dismissOutside && e.target === panel.value) {
              const r = panel.value.getBoundingClientRect();
              if (
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
              )
                p.onClose();
            }
          },
          onMousedown: (e: MouseEvent) => e.stopPropagation(),
        },
        p.content?.() ?? slots.default?.()
      );
  },
});

/** Refuse drafts captured from a document that has been replaced. */
export function useDialogGeneration(open: () => boolean, onClose: () => void): () => boolean {
  const editor = useDocxEditor();
  const generation = useEditorState(() => editor.value?.mountGeneration ?? 0);
  let captured: number | null = null;
  watch(
    [open, generation],
    ([isOpen, current]) => {
      if (!isOpen) {
        captured = null;
        return;
      }
      if (captured !== null && captured !== current) {
        onClose();
        return;
      }
      if (editor.value?.surface) captured = current;
    },
    { immediate: true, flush: 'post' }
  );
  return () => {
    if (captured !== null && editor.value?.surface && captured === editor.value.mountGeneration)
      return true;
    onClose();
    return false;
  };
}
