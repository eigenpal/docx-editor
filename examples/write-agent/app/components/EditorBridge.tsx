'use client';

import { useEffect } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

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
