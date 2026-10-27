import { inject, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { UnsupportedElementHost, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { UnsupportedElementRegistryContext } from './unsupported-element-registry';

/**
 * Register one declaration and return a reader for the occurrences it wins, in document
 * order. Read it in the render function so the component updates when occurrences change.
 */
export function useUnsupportedElementDeclaration(
  rule: () => UnsupportedElementRule,
  component: string
): () => readonly UnsupportedElementHost[] {
  const registry = inject(UnsupportedElementRegistryContext, null);
  if (!registry) throw new Error(`${component} must render inside DocxEditor.Root.`);
  const id = Symbol('unsupported-element-declaration');
  const version = shallowRef(registry.snapshot());
  const stop = registry.subscribe(() => {
    version.value = registry.snapshot();
  });
  watch(
    () => {
      const { match, layout, includeRenderedDrawings } = rule();
      return [match, layout, layout?.width, layout?.height, includeRenderedDrawings] as const;
    },
    ([match, layout, width, height, includeRenderedDrawings]) => {
      registry.register(id, {
        includeRenderedDrawings,
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
    return registry.hosts(id);
  };
}
