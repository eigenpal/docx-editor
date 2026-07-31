// The provider-first composition layer's one piece of shared state: the editor instance.
//
// `DocxEditorRoot` owns the facade's lifetime and publishes it here; `DocxEditorContent`
// and every hook read it. The value is `null` until the Root's mount effect has run —
// hooks answer with honest loading state rather than throwing, so a toolbar can render
// on the very first frame without guarding.

import { createContext, useContext } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';

export const DocxEditorContext = createContext<DocxEditorInstance | null>(null);

/**
 * The editor instance from the nearest `DocxEditor.Root`, or `null` before the Root's
 * mount effect has created it (and outside any Root). Deliberately not a throwing
 * variant: pre-mount is a normal frame every consumer renders through, and the state
 * hooks built on this already answer it with a typed loading snapshot.
 *
 * @public
 */
export function useDocxEditor(): DocxEditorInstance | null {
  return useContext(DocxEditorContext);
}
