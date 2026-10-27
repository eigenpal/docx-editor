import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  shallowRef,
  watch,
  type PropType,
  type SlotsType,
  type VNodeChild,
} from 'vue';
import type { UnsupportedElement, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { UnsupportedElementRegistryContext } from './unsupported-element-registry';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** Props for a registered unsupported-content renderer. @public */
export interface DocxEditorUnsupportedElementProps extends UnsupportedElementRule {
  /**
   * Include partially rendered drawings (`support: 'partial'`). Defaults to `false`.
   * Excludes fully supported drawings, hidden drawings, and drawings without a layout position.
   * Excludes shapes with editable text. Partially rendered shapes without text remain eligible.
   */
  includePartial?: UnsupportedElementRule['includePartial'];
}

/**
 * Register a renderer under DocxEditor or DocxEditor.Root.
 * The first mounted matching declaration wins. Prop updates retain its priority.
 * Omit match for a catch-all. Empty slot content, or a child component that renders nothing,
 * keeps what the editor shows. The default slot
 * renders once for each occurrence; put composables in a child component that it renders. To
 * build a preview DOCX in that component, use `drawingPreviewDocx` from
 * `@docx-editor.dev/core/editor`.
 * Layout uses points and only sizes content without an existing layout box. Custom content
 * gets the occurrence's box (`element.bounds`); size it to 100% of the width and height.
 * Clicking a custom preview selects the underlying drawing for moving, resizing, or deletion.
 * Links, buttons, and form fields retain their normal behavior.
 * Components can remount when pagination or virtualization removes an occurrence.
 * @public
 */
export const DocxEditorUnsupportedElement = defineComponent({
  name: 'DocxEditorUnsupportedElement',
  props: {
    includePartial: { type: Boolean, default: false },
    match: { type: Function as PropType<UnsupportedElementRule['match']>, default: undefined },
    layout: { type: Object as PropType<UnsupportedElementRule['layout']>, default: undefined },
  },
  slots: Object as SlotsType<{ default: (props: { element: UnsupportedElement }) => VNodeChild }>,
  setup(props, { slots }) {
    const registry = inject(UnsupportedElementRegistryContext, null);
    if (!registry)
      throw new Error('DocxEditor.UnsupportedElement must render inside DocxEditor.Root.');
    const id = Symbol('unsupported-element-declaration');
    const version = shallowRef(registry.snapshot());
    const stop = registry.subscribe(() => {
      version.value = registry.snapshot();
    });
    watch(
      () =>
        [
          props.match,
          props.layout,
          props.layout?.width,
          props.layout?.height,
          props.includePartial,
        ] as const,
      ([match, layout, width, height, includePartial]) => {
        registry.register(id, {
          includePartial,
          ...(match ? { match } : {}),
          ...(layout ? { layout: { width: width!, height: height! } } : {}),
        });
      },
      { immediate: true }
    );
    onBeforeUnmount(() => {
      stop();
      registry.unregister(id);
    });
    return () => {
      void version.value;
      return registry.hosts(id).map((host) =>
        h(UnsupportedElementPlaceholder, {
          key: host.key,
          host,
          render: (element: UnsupportedElement) => slots.default?.({ element }),
        })
      );
    };
  },
});
