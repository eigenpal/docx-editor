import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DocxEditor,
  DocumentRefreshError,
  createDocumentRefresh,
  useDocxEditor,
  type RefreshChangeInput,
  type RefreshSubmission,
} from '@docx-editor.dev/react';
import { createT, en } from '@docx-editor.dev/i18n';
import '@docx-editor.dev/core/styles/editor.css';
import './styles.css';

const t = createT(en);

interface ServerUpdate {
  documentId: string;
  submissionId: string;
  sequence: number;
  bytes: string;
  changes: RefreshChangeInput[];
}

function UpdateControls() {
  const editor = useDocxEditor();
  return editor ? <ReadyControls editor={editor} /> : null;
}

function ReadyControls({ editor }: { editor: NonNullable<ReturnType<typeof useDocxEditor>> }) {
  const refresh = createDocumentRefresh(editor);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sampleEdited, setSampleEdited] = useState(false);
  const sampleEditedRef = useRef(false);
  const [scrollToChange, setScrollToChange] = useState(false);
  const [message, setMessage] = useState(t('documentRefresh.idle'));

  useEffect(
    () => () => {
      request.current?.abort();
      refresh.cancel();
    },
    [refresh]
  );

  // This fixed fixture demo requires a reset after any user edit.
  useEffect(
    () =>
      editor.on('change', (change) => {
        if (change.source) return;
        sampleEditedRef.current = true;
        setSampleEdited(true);
        if (!request.current) setMessage(t('documentRefresh.sampleEdited'));
      }),
    [editor]
  );

  async function update() {
    if (request.current || sampleEditedRef.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    let submission: RefreshSubmission | undefined;
    try {
      submission = await refresh.capture();
      if (controller.signal.aborted) return;
      if (sampleEditedRef.current) {
        setMessage(t('documentRefresh.sampleEdited'));
        return;
      }
      setMessage(t('documentRefresh.processing'));
      const response = await fetch('/api/update', {
        method: 'POST',
        headers: { 'X-Submission-Id': submission.id },
        signal: controller.signal,
        // A real processor can receive body: submission.bytes.
      });
      if (!response.ok) throw new Error('request-failed');
      const output: ServerUpdate = await response.json();
      if (output.documentId !== 'schedule' || output.submissionId !== submission.id) {
        throw new Error('identity-mismatch');
      }
      if (controller.signal.aborted) return;
      const result = await refresh.applyUpdate({
        submission,
        sequence: output.sequence,
        bytes: Uint8Array.from(atob(output.bytes), (c) => c.charCodeAt(0)),
        changes: output.changes,
      });
      if (!result.ok) {
        setMessage(
          result.code === 'local-edits'
            ? t('documentRefresh.sampleEdited')
            : `${t('documentRefresh.failed')} (${result.code})`
        );
        return;
      }
      const change = result.changes.find((c) => c.status === 'available');
      const moved =
        scrollToChange && change && refresh.navigateToChange(change.id, { behavior: 'instant' });
      // Keep the default blue fill, padding, and rounded corners.
      refresh.highlightChanges({
        timeoutMs: 3000,
        animation: { durationMs: 180, exitDurationMs: 300 },
      });
      setDone(true);
      setMessage(moved ? t('documentRefresh.scrolled') : t('documentRefresh.complete'));
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(
          error instanceof DocumentRefreshError
            ? `${t('documentRefresh.failed')} (${error.code})`
            : t('documentRefresh.failed')
        );
      }
    } finally {
      if (submission) refresh.finish(submission);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="refresh-controls">
      <h1>{t('documentRefresh.title')}</h1>
      <p>{t('documentRefresh.sampleDescription')}</p>
      <label>
        <input
          type="checkbox"
          checked={scrollToChange}
          disabled={busy || done || sampleEdited}
          onChange={(event) => setScrollToChange(event.target.checked)}
        />
        {t('documentRefresh.scrollToChange')}
      </label>{' '}
      <button disabled={busy || done || sampleEdited} onClick={update}>
        {busy ? t('documentRefresh.processingLabel') : t('documentRefresh.start')}
      </button>{' '}
      <button disabled={busy} onClick={() => location.reload()}>
        {t('documentRefresh.reset')}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}

function App() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/document', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('load-failed');
        const document = await response.arrayBuffer();
        if (!controller.signal.aborted) setBytes(document);
      } catch {
        if (!controller.signal.aborted) setError(t('documentRefresh.loadError'));
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  if (!bytes) return <p role="status">{error || t('loading.label')}</p>;
  return (
    <div
      className="docx-editor"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DocxEditor.Root document={bytes} mode="edit">
        <UpdateControls />
        <DocxEditor.Toolbar />
        <DocxEditor.Viewport style={{ flex: 1, minHeight: 0 }}>
          <DocxEditor.Content />
        </DocxEditor.Viewport>
      </DocxEditor.Root>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
