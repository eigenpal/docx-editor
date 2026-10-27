import type { ReactNode } from 'react';
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
  /**
   * Render this occurrence. Return `null`, `false`, an empty fragment or array, or whitespace to
   * keep what the editor shows: the placeholder, or the rendered drawing.
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
  includeRenderedDrawings,
  children,
}: DocxEditorUnsupportedElementProps) {
  const hosts = useUnsupportedElementDeclaration(
    { match, layout, includeRenderedDrawings },
    'DocxEditor.UnsupportedElement'
  );
  return hosts.map((host) => (
    <UnsupportedElementPlaceholder key={host.key} host={host}>
      {children({ element: host.unsupported })}
    </UnsupportedElementPlaceholder>
  ));
}
