import { useEffect, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { EventLogPanel } from '../../telemetry-stack/client/event-log';
import { consent, eventLog, telemetry } from './telemetry';

// Outside the component, so the array stays the same across renders. `reviewModule` turns on
// suggesting mode, where refused tracked changes come with hints.
const MODULES = [reviewModule(), telemetry.module];

export function App() {
  const [document, setDocument] = useState<Uint8Array | null>(null);
  const [opened, setOpened] = useState(0);
  const [shareDiagnostics, setShareDiagnostics] = useState(consent.analytics);

  useEffect(() => {
    void fetch('/sample.docx')
      .then((response) => response.arrayBuffer())
      .then((bytes) => setDocument(new Uint8Array(bytes)));
  }, []);

  async function openFile(file: File | undefined) {
    if (!file) return;
    setDocument(new Uint8Array(await file.arrayBuffer()));
    // A new key mounts a new editor, so the open is reported like a fresh page load.
    setOpened((count) => count + 1);
  }

  return (
    <div className="example-shell">
      <header className="example-bar">
        <h1>Editor telemetry, one person</h1>
        <label>
          <input
            type="checkbox"
            checked={shareDiagnostics}
            onChange={(event) => {
              consent.analytics = event.target.checked;
              setShareDiagnostics(event.target.checked);
            }}
          />{' '}
          Share anonymous diagnostics
        </label>
        <label>
          Open a .docx file{' '}
          <input
            type="file"
            accept=".docx"
            data-testid="open-file"
            onChange={(event) => void openFile(event.target.files?.[0])}
          />
        </label>
        <a href="http://localhost:3300/d/docx-editor-experience" target="_blank" rel="noreferrer">
          Dashboard
        </a>
      </header>
      <main className="example-main">
        <section className="example-editor">
          {document ? (
            <DocxEditor key={opened} document={document} modules={MODULES} author="Example user" />
          ) : (
            <p>Loading…</p>
          )}
        </section>
        <EventLogPanel log={eventLog} />
      </main>
    </div>
  );
}
