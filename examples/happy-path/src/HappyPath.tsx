// The packaged <DocxEditor>: one element for the whole editor — frame, menu bar, toolbar,
// rulers, navigation pane, hyperlink popover, context menu. This file adds only what a
// library cannot decide for you: where bytes come from, where they go, and what to call them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditor, useFonts, type DocxEditorRef } from '@docx-editor.dev/react';
import type { DocumentSource } from '@docx-editor.dev/core/contracts/editor';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import { packagedFonts } from '@docx-editor.dev/fonts';
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
  // The packaged substitute faces, served per document: the engine calls this after the
  // parse with the families the file names, so only those load — plus the document's
  // default face, which is Calibri, so Carlito comes along whatever the file says.
  // `useFonts` gives it ONE identity for the component's life,
  // which matters because the `fonts` prop remounts the editor when its identity changes
  // and `packagedFonts()` written inline is a new function every render.
  //
  // NOTHING GATES ON FONTS any more. The document opens on the fixed measurer and
  // re-paginates when the faces land; that remount rebuilds from the CURRENT tree, so an
  // edit made in between survives it — the undo stack behind it does not, which is the one
  // thing the eager `await defaultFonts()` still buys.
  const fonts = useFonts(packagedFonts());
  const [name, setName] = useState('sample');

  useEffect(() => {
    void fetch('/sample.docx')
      .then((response) => response.arrayBuffer())
      // Keep whatever is already loaded: New or Open can win this race, and the sample
      // must not land on top of the document the user picked.
      .then((bytes) => setDoc((chosen) => chosen ?? bytes));
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
        onOpen={() => picker.current?.click()}
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
