import { useState } from 'react';
import { DocxEditor, type UnsupportedElement } from '@docx-editor.dev/react';
function GraphicCard({ element }: { element: UnsupportedElement }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  return (
    <section className="graphic-card" aria-label="Custom unsupported content">
      <strong>{element.label}</strong>
      <span>{element.kind}</span>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        Details
      </button>
      {expanded && <small data-testid="details">{element.nodeId}</small>}
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
  const [custom, setCustom] = useState(true);
  const [zoom, setZoom] = useState(1);
  return (
    <main>
      <header>
        <h1>React graphic review</h1>
        <a href="?framework=vue">Open Vue trial</a>
        <label>
          <input
            type="checkbox"
            checked={custom}
            onChange={(event) => setCustom(event.target.checked)}
          />
          Custom placeholders
        </label>
        <button type="button" onClick={() => setZoom(zoom === 1 ? 1.1 : 1)}>
          Change zoom
        </button>
      </header>
      <div className="editor-box">
        <DocxEditor
          document={bytes}
          zoom={zoom}
          renderUnsupportedElement={
            custom ? (element) => <GraphicCard element={element} /> : undefined
          }
        />
      </div>
    </main>
  );
}
