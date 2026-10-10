'use client';

// Roast My Doc: an LLM agent reading and commenting on a live document.
//
// The layout is the whole point of this file. The editor and the panel are
// SIBLINGS: the packages ship no agent slot, and they should not. An assistant
// panel is app chrome, so it is composed here like any other pane, and
// `<EditorBridge>` is the one wire between them.
//
// `modules={PRO_MODULES}` is not optional for this demo. Comments are a pro
// capability, and `useReviewOf(...).comment` inside the panel is what actually
// lands each roast. `<DocxEditorReview />` renders them as cards beside the
// page; remove it and the comments still exist, they just have no rail.

import { useCallback, useMemo, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { EditorBridge } from './EditorBridge';
import { AgentPanel } from './AgentPanel';
import { seedDocx } from '../seed-document';

// One stable array: module registration is construction-time.
const PRO_MODULES = [reviewModule()];

export function RoastMyDoc() {
  const [editor, setEditor] = useState<DocxEditorInstance | null>(null);
  const [title, setTitle] = useState('Q3 Strategic Alignment Readout');
  const editorRef = useRef<DocxEditorRef>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seed = useMemo(() => seedDocx(), []);

  // Stable identity: `EditorBridge`'s effect depends on it, and an inline arrow
  // would tear the panel's runtime down on every render.
  const onEditor = useCallback((next: DocxEditorInstance | null) => setEditor(next), []);

  return (
    <div className="app">
      <input
        ref={fileRef}
        type="file"
        accept=".docx"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          // `load` swaps the document in place, so the editor is not remounted
          // and the panel keeps the runtime it already has.
          editorRef.current?.load(new Uint8Array(await file.arrayBuffer()));
          setTitle(file.name.replace(/\.docx$/i, ''));
        }}
      />
      <div className="editor">
        <DocxEditor
          ref={editorRef}
          document={seed}
          author="You"
          modules={PRO_MODULES}
          title={title}
          onTitleChange={setTitle}
          renderTitleBarRight={() => (
            <button type="button" className="open-btn" onClick={() => fileRef.current?.click()}>
              Open .docx
            </button>
          )}
        >
          <DocxEditorReview />
          <EditorBridge onEditor={onEditor} />
        </DocxEditor>
      </div>
      <AgentPanel editor={editor} />
    </div>
  );
}
