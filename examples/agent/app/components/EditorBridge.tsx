'use client';

import { useEffect } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

/**
 * Lifts the live editor INSTANCE out of the editor's own tree.
 *
 * `useDocxEditor()` reads the editor off React context, so it only answers from
 * inside `<DocxEditor>`. The agent panel renders BESIDE the editor and needs
 * that instance, so this component renders nothing and exists purely to carry
 * it up.
 *
 * `<DocxEditor onReady>` is not a substitute: it hands over the narrower
 * `Editor` facade, and editor-api's `createBrowser` does not accept it.
 *
 * Pass a STABLE `onEditor` (a `useState` setter, or `useCallback`). The effect
 * depends on it, and an inline arrow re-runs the unmount path on every render,
 * which tears the panel's runtime down mid-conversation.
 */
export function EditorBridge({
  onEditor,
}: {
  onEditor: (editor: DocxEditorInstance | null) => void;
}) {
  const editor = useDocxEditor();
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  return null;
}
