import { defineComponent, h, type PropType, type SlotsType, type VNodeChild } from 'vue';
import type { UnsupportedElement, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { useUnsupportedElementDeclaration } from './unsupported-element-declaration';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** Props for a registered unsupported-content renderer. @public */
export interface DocxEditorUnsupportedElementProps extends UnsupportedElementRule {
  /**
   * Also offer drawings that the editor renders, not only placeholders. To replace drawings
   * with images from a rendering service, `DocxEditor.DrawingPreview` is simpler.
   */
  includeRenderedDrawings?: UnsupportedElementRule['includeRenderedDrawings'];
}

/**
 * Register a renderer under DocxEditor or DocxEditor.Root.
 * The first mounted matching declaration wins. Prop updates retain its priority.
 * Omit match for a catch-all. Empty slot content keeps what the editor shows: the placeholder,
 * or the rendered drawing.
 * Layout uses points and only sizes content without an existing layout box.
 * Components can remount when pagination or virtualization removes an occurrence.
 * @public
 */
export const DocxEditorUnsupportedElement = defineComponent({
  name: 'DocxEditorUnsupportedElement',
  props: {
    includeRenderedDrawings: { type: Boolean, default: false },
    match: { type: Function as PropType<UnsupportedElementRule['match']>, default: undefined },
    layout: { type: Object as PropType<UnsupportedElementRule['layout']>, default: undefined },
  },
  slots: Object as SlotsType<{ default: (props: { element: UnsupportedElement }) => VNodeChild }>,
  setup(props, { slots }) {
    const hosts = useUnsupportedElementDeclaration(
      () => ({
        includeRenderedDrawings: props.includeRenderedDrawings,
        match: props.match,
        layout: props.layout,
      }),
      'DocxEditor.UnsupportedElement'
    );
    return () =>
      hosts().map((host) =>
        h(UnsupportedElementPlaceholder, {
          key: host.key,
          host,
          render: (element: UnsupportedElement) => slots.default?.({ element }),
        })
      );
  },
});
