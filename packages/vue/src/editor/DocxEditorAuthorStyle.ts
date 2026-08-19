import { defineComponent, inject, onUnmounted, watch } from 'vue';
import type { RevisionAuthorStyle } from '@docx-editor.dev/core/editor';
import { RevisionStyleRegistryContext } from './revision-style-registry';

/** @public */
export interface DocxEditorAuthorStyleProps extends RevisionAuthorStyle {
  author: string;
}

/** @public */
export const DocxEditorColorByChangeType = defineComponent({
  name: 'DocxEditorColorByChangeType',
  setup() {
    const registry = inject(RevisionStyleRegistryContext, null);
    const id = Symbol('revision-style-declaration');
    registry?.registerScheme(id);
    onUnmounted(() => registry?.unregister(id));
    return () => null;
  },
});

/** @public */
export const DocxEditorAuthorStyle = defineComponent({
  name: 'DocxEditorAuthorStyle',
  props: {
    author: { type: String, required: true },
    color: { type: String, default: undefined },
    background: { type: String, default: undefined },
    spanClassName: { type: String, default: undefined },
    avatarUrl: { type: String, default: undefined },
  },
  setup(props) {
    const registry = inject(RevisionStyleRegistryContext, null);
    const id = Symbol('revision-style-declaration');
    watch(
      () =>
        [
          props.author,
          props.color,
          props.background,
          props.spanClassName,
          props.avatarUrl,
        ] as const,
      ([author, color, background, spanClassName, avatarUrl]) => {
        registry?.register(id, author, {
          ...(color !== undefined ? { color } : {}),
          ...(background !== undefined ? { background } : {}),
          ...(spanClassName !== undefined ? { spanClassName } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        });
      },
      { immediate: true }
    );
    onUnmounted(() => registry?.unregister(id));
    return () => null;
  },
}) as unknown as {
  new (): { $props: DocxEditorAuthorStyleProps };
};
