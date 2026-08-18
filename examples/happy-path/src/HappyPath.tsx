// The packaged <DocxEditor>: one element for the whole editor — frame, menu bar, toolbar,
// rulers, navigation pane, hyperlink popover, context menu. This file adds only what a
// library cannot decide for you: where bytes come from, where they go, and what to call them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import type { DocumentSource } from '@docx-editor.dev/core/contracts/editor';
import { blankDocumentBytes, type FontConfigurationFragment } from '@docx-editor.dev/core/editor';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { DocumentMark } from './DocumentMark';
import './styles.css';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Comments and tracked changes. Read once, when the instance is built. */
const MODULES = [reviewModule()];

function download(bytes: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}

export function HappyPath() {
  const editor = useRef<DocxEditorRef>(null);
  const picker = useRef<HTMLInputElement>(null);
  // `undefined` is NO document, not an empty one: the packaged loading screen holds until
  // bytes arrive. Press New for an empty document.
  const [doc, setDoc] = useState<DocumentSource>();
  // Font identity remounts the editor, so it is resolved once. Without fonts, layout
  // estimates wrap points instead of matching Word.
  const [fonts, setFonts] = useState<FontConfigurationFragment>();
  const [name, setName] = useState('sample');
  // Saved state, the only way a host can know it: the revision `onChange` reports against
  // the one you last wrote out.
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(0);
  const dirty = revision !== saved;

  useEffect(() => {
    const sample = fetch('/sample.docx').then((response) => response.arrayBuffer());
    void Promise.all([defaultFonts(), sample]).then(([faces, bytes]) => {
      setFonts(faces);
      setDoc(bytes);
    });
  }, []);

  const open = useCallback((source: DocumentSource, title: string) => {
    setDoc(source);
    setName(title);
    setRevision(0);
    setSaved(0);
  }, []);

  const save = useCallback(async () => {
    const written = revision; // an edit landing during save() belongs to the NEXT save
    const bytes = await editor.current?.save();
    if (!bytes) return;
    download(bytes, name);
    setSaved(written);
  }, [name, revision]);

  return (
    <div className="happy-app">
      <DocxEditor
        ref={editor}
        document={doc}
        fonts={fonts}
        modules={MODULES}
        author="Happy Path"
        title={name}
        onTitleChange={setName}
        onChange={(change) => setRevision(change.revision)}
        onSave={() => void save()}
        onOpen={() => picker.current?.click()}
        renderTitleBarLeft={() => (
          <div className="happy-identity">
            <DocumentMark dirty={dirty} />
            <span className="happy-status" role="status">
              {dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          </div>
        )}
        renderTitleBarRight={() => (
          <div className="happy-actions">
            <input
              ref={picker}
              type="file"
              accept=".docx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ''; // so picking the same file re-fires `change`
                if (file) void file.arrayBuffer().then((b) => open(b, file.name.slice(0, -5)));
              }}
            />
            <button
              type="button"
              className="happy-button"
              onClick={() => open(blankDocumentBytes(), 'Untitled document')}
            >
              New
            </button>
            <button type="button" className="happy-button" onClick={() => picker.current?.click()}>
              Open
            </button>
            <button
              type="button"
              className="happy-button happy-button--commit"
              onClick={() => void save()}
              disabled={!dirty}
            >
              Save
            </button>
          </div>
        )}
      >
        <DocxEditorReview />
      </DocxEditor>
    </div>
  );
}
