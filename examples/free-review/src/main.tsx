import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { DocxEditor, useFonts, type DocxEditorRef } from '@docx-editor.dev/react';
import type { DocumentSource } from '@docx-editor.dev/core/contracts/editor';
import type { EditorModule } from '@docx-editor.dev/core/contracts/modules';
import { collectReviewItems, revisionItemsOf } from '@docx-editor.dev/core/store';
import { packagedFonts } from '@docx-editor.dev/fonts';
import '@docx-editor.dev/core/styles/editor.css';

const freeReview: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
    collectReviewItems,
    revisionItemsOfParagraph: (part, paragraphId) =>
      revisionItemsOf(part).filter((i) =>
        i.ranges.every(
          (r) => r.start.paragraphId === paragraphId && r.end.paragraphId === paragraphId
        )
      ),
  },
};
const MODULES = new URLSearchParams(location.search).has('nomodule') ? [] : [freeReview];

function App() {
  const ref = useRef<DocxEditorRef>(null);
  const [doc, setDoc] = useState<DocumentSource>();
  const fonts = useFonts(packagedFonts());
  useEffect(() => {
    void fetch('/test.docx')
      .then((r) => r.arrayBuffer())
      .then(setDoc);
    (window as any).__editor = ref;
  }, []);
  return (
    <div style={{ height: '100%' }}>
      <DocxEditor
        ref={ref}
        document={doc}
        fonts={fonts}
        modules={MODULES}
        author="Advisor"
        title="test"
      />
    </div>
  );
}
createRoot(document.getElementById('app')!).render(<App />);
