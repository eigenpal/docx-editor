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
import './styles.css';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const UNTITLED = 'Untitled document';

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
  // bytes arrive. `document="blank"` asks for an empty one.
  //
  // New does not pass `'blank'`. `'blank'` is a constant, so a second `'blank'` is the same
  // value: the prop never changes identity, nothing reloads, and whatever the user typed
  // stays. New must work every time, so it passes fresh `blankDocumentBytes()` instead.
  const [doc, setDoc] = useState<DocumentSource>();
  // Fonts are read at MOUNT and their identity remounts the editor, so nothing may open a
  // document before they land: the remount would rebuild from the bytes and drop whatever
  // had been typed in between. New and Open wait for this rather than racing it. Without
  // fonts at all, layout estimates wrap points instead of matching Word.
  const [fonts, setFonts] = useState<FontConfigurationFragment>();
  const ready = fonts !== undefined;
  const [name, setName] = useState('sample');

  useEffect(() => {
    const sample = fetch('/sample.docx').then((response) => response.arrayBuffer());
    void Promise.all([defaultFonts(), sample]).then(([faces, bytes]) => {
      setFonts(faces);
      // Keep whatever is already loaded: New or Open can win this race, and the sample
      // must not land on top of the document the user picked.
      setDoc((chosen) => chosen ?? bytes);
    });
  }, []);

  const open = useCallback((source: DocumentSource, title: string) => {
    setDoc(source);
    setName(title);
  }, []);

  const save = useCallback(async () => {
    const bytes = await editor.current?.save();
    if (bytes) download(bytes, name);
  }, [name]);

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
        onSave={() => void save()}
        onOpen={() => ready && picker.current?.click()}
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
                if (!file) return;
                // Drop only a real `.docx` suffix. Cutting five characters off the end
                // would eat the name itself when the file is called anything else.
                const title = file.name.replace(/\.docx$/i, '') || UNTITLED;
                void file.arrayBuffer().then((b) => open(b, title));
              }}
            />
            <button
              type="button"
              className="happy-button"
              onClick={() => open(blankDocumentBytes(), UNTITLED)}
              disabled={!ready}
            >
              New
            </button>
            <button
              type="button"
              className="happy-button"
              onClick={() => picker.current?.click()}
              disabled={!ready}
            >
              Open
            </button>
            <button
              type="button"
              className="happy-button happy-button--commit"
              onClick={() => void save()}
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
