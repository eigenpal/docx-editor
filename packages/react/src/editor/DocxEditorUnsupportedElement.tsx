import { useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { UnsupportedElement, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { UnsupportedElementRegistryContext } from './unsupported-element-registry';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** Props for a registered unsupported-content renderer. @public */
export interface DocxEditorUnsupportedElementProps extends UnsupportedElementRule {
  /**
   * Also offer drawings that render without some features (`element.support` is `partial`),
   * not only placeholders. Fully supported drawings are never offered.
   */
  includePartial?: UnsupportedElementRule['includePartial'];
  /**
   * Render this occurrence. Return `null`, `false`, an empty fragment or array, or whitespace to
   * keep what the editor shows: the placeholder, or the partly rendered drawing.
   */
  children: (props: { element: UnsupportedElement }) => ReactNode;
}

/**
 * Register a renderer under DocxEditor or DocxEditor.Root.
 * The first mounted matching declaration wins. Prop updates retain its priority.
 * Omit match for a catch-all. Returning `null`, `false`, an empty fragment or array, or
 * whitespace keeps what the editor shows.
 * Layout uses points and only sizes content without an existing layout box.
 * Components can remount when pagination or virtualization removes an occurrence.
 * @public
 */
export function DocxEditorUnsupportedElement({
  match,
  layout,
  includePartial,
  children,
}: DocxEditorUnsupportedElementProps) {
  const registry = useContext(UnsupportedElementRegistryContext);
  if (!registry)
    throw new Error('DocxEditor.UnsupportedElement must render inside DocxEditor.Root.');
  const id = useRef(Symbol('unsupported-element-declaration')).current;
  useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
  useLayoutEffect(() => {
    registry.register(id, {
      includePartial,
      ...(match ? { match } : {}),
      ...(layout ? { layout } : {}),
    });
  }, [registry, id, match, layout, includePartial]);
  useLayoutEffect(() => () => registry.unregister(id), [registry, id]);
  return registry.hosts(id).map((host) => (
    <UnsupportedElementPlaceholder key={host.key} host={host}>
      {children({ element: host.unsupported })}
    </UnsupportedElementPlaceholder>
  ));
}
