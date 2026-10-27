import { useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { UnsupportedElementHost, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { UnsupportedElementRegistryContext } from './unsupported-element-registry';

/** Register one declaration and return the occurrences it wins, in document order. */
export function useUnsupportedElementDeclaration(
  rule: UnsupportedElementRule,
  component: string
): readonly UnsupportedElementHost[] {
  const registry = useContext(UnsupportedElementRegistryContext);
  if (!registry) throw new Error(`${component} must render inside DocxEditor.Root.`);
  const id = useRef(Symbol('unsupported-element-declaration')).current;
  useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
  const { match, layout, includeRenderedDrawings } = rule;
  useLayoutEffect(() => {
    registry.register(id, {
      includeRenderedDrawings,
      ...(match ? { match } : {}),
      ...(layout ? { layout } : {}),
    });
  }, [registry, id, match, layout, includeRenderedDrawings]);
  useLayoutEffect(() => () => registry.unregister(id), [registry, id]);
  return registry.hosts(id);
}
