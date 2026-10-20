import { useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef, type UnsupportedElement } from '@docx-editor.dev/react';
import {
  drawingMatch,
  approvalMatch,
  referenceMatch,
  approvalLayout,
  referenceLayout,
  sourceField,
} from './rules';
function ReviewCard({ element }: { element: UnsupportedElement }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  return (
    <section
      className="graphic-card"
      data-local-name={element.localName}
      aria-label="Custom unsupported content"
    >
      <strong>
        {element.localName === 'approval' ? sourceField(element, 'title') : element.label}
      </strong>
      {element.localName === 'approval' && (
        <span className="status">Status: {sourceField(element, 'status')}</span>
      )}
      <span>
        {element.namespaceUri} · {element.placement}
      </span>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        Details
      </button>
      {expanded && (
        <small data-testid="details">
          {element.ownerPartName} · {element.nodeId}
        </small>
      )}
      <input
        aria-label="Annotation"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Local annotation"
      />
    </section>
  );
}
export default function ReactTrial({ bytes }: { bytes: Uint8Array }) {
  const editor = useRef<DocxEditorRef>(null);
  const [registered, setRegistered] = useState(true);
  const [custom, setCustom] = useState(true);
  const [zoom, setZoom] = useState(1);
  async function save() {
    const bytes = await editor.current?.save();
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'consumer-review.docx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main>
      <header>
        <h1>React approval review</h1>
        <a href="?framework=vue">Open Vue trial</a>
        <label>
          <input
            type="checkbox"
            checked={registered}
            onChange={(event) => setRegistered(event.target.checked)}
          />
          Register custom XML
        </label>
        <label>
          <input
            type="checkbox"
            checked={custom}
            onChange={(event) => setCustom(event.target.checked)}
          />
          Custom components
        </label>
        <button type="button" onClick={() => setZoom(zoom === 1 ? 1.1 : 1)}>
          Change zoom
        </button>
        <button type="button" onClick={save}>
          Save DOCX
        </button>
      </header>
      <div className="editor-box">
        <DocxEditor ref={editor} document={bytes} zoom={zoom}>
          {registered && (
            <DocxEditor.UnsupportedElement match={approvalMatch} layout={approvalLayout}>
              {({ element }) => (custom ? <ReviewCard element={element} /> : null)}
            </DocxEditor.UnsupportedElement>
          )}
          {registered && (
            <DocxEditor.UnsupportedElement match={referenceMatch} layout={referenceLayout}>
              {({ element }) =>
                custom ? (
                  <span className="reference-chip" data-local-name={element.localName}>
                    {sourceField(element, 'token')}
                  </span>
                ) : null
              }
            </DocxEditor.UnsupportedElement>
          )}
          <DocxEditor.UnsupportedElement match={drawingMatch}>
            {({ element }) => (custom && element.drawing ? <ReviewCard element={element} /> : null)}
          </DocxEditor.UnsupportedElement>
        </DocxEditor>
      </div>
    </main>
  );
}
