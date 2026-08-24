'use client';

import { useCallback, useMemo, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { seedDocx } from '../seed-document';
import { EditorBridge } from './EditorBridge';
import { WriterPanel } from './WriterPanel';

const MODULES = [reviewModule()];

export function WriterWorkspace() {
  const [editor, setEditor] = useState<DocxEditorInstance | null>(null);
  const [title, setTitle] = useState('Seeded writer draft');
  const seed = useMemo(() => seedDocx(), []);
  const onEditor = useCallback((next: DocxEditorInstance | null) => setEditor(next), []);

  return (
    <main className="app">
      <section className="editor">
        <DocxEditor
          document={seed}
          author="Writer agent"
          modules={MODULES}
          title={title}
          onTitleChange={setTitle}
        >
          <DocxEditorReview />
          <EditorBridge onEditor={onEditor} />
        </DocxEditor>
      </section>
      <WriterPanel editor={editor} onDocumentTitle={setTitle} />
    </main>
  );
}
