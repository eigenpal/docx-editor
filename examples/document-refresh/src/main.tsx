import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DocxEditor,
  DocumentRefreshError,
  createDocumentRefresh,
  useDocxEditor,
} from '@docx-editor.dev/react';
import { exampleText as t } from '../../shared/example-text';
import '@docx-editor.dev/core/styles/editor.css';
import './styles.css';
import { receiveSampleUpdates, runRefreshJob } from './refresh-job';

function UpdateControls() {
  const editor = useDocxEditor();
  return editor ? <ReadyControls editor={editor} /> : null;
}

function ReadyControls({ editor }: { editor: NonNullable<ReturnType<typeof useDocxEditor>> }) {
  const refresh = createDocumentRefresh(editor);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const round = useRef(0);
  const state = useSyncExternalStore(refresh.subscribe, refresh.snapshot);
  const [includeLateResult, setIncludeLateResult] = useState(false);
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
    try {
      setMessage(t('documentRefresh.processing'));
      await runRefreshJob(
        refresh,
        controller.signal,
        (submission) =>
          receiveSampleUpdates(submission, controller.signal, ++round.current, includeLateResult),
        (result) => {
          if (!result.ok) {
            setMessage(
              result.code === 'local-edits'
                ? t('documentRefresh.sampleEdited')
                : result.code === 'out-of-order'
                  ? t('documentRefresh.lateResult')
                  : `${t('documentRefresh.failed')} (${result.code})`
            );
            return;
          }
          const change = result.changes.find((c) => c.isNew && c.status === 'available');
          const moved =
            scrollToChange &&
            change &&
            refresh.navigateToChange(change.id, { behavior: 'instant' });
          refresh.highlightChanges({ timeoutMs: 5000 });
          setMessage(moved ? t('documentRefresh.scrolled') : t('documentRefresh.complete'));
        }
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(
          error instanceof DocumentRefreshError
            ? `${t('documentRefresh.failed')} (${error.code})`
            : t('documentRefresh.failed')
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="refresh-controls">
      <h1>{t('documentRefresh.title')}</h1>
      <p>{t('documentRefresh.description')}</p>
      <p>{t('documentRefresh.limitations')}</p>
      <label>
        <input
          type="checkbox"
          checked={scrollToChange}
          disabled={busy || sampleEdited}
          onChange={(event) => setScrollToChange(event.target.checked)}
        />
        {t('documentRefresh.scrollToChange')}
      </label>{' '}
      <label>
        <input
          type="checkbox"
          checked={includeLateResult}
          disabled={busy}
          onChange={(event) => setIncludeLateResult(event.target.checked)}
        />
        {t('documentRefresh.testLateResult')}
      </label>
      <button disabled={busy || sampleEdited} onClick={update}>
        {busy ? t('documentRefresh.processingLabel') : t('documentRefresh.start')}
      </button>{' '}
      <button
        disabled={!busy}
        onClick={() => {
          request.current?.abort();
          refresh.cancel();
          setMessage(t('documentRefresh.cancelled'));
        }}
      >
        {t('documentRefresh.cancel')}
      </button>{' '}
      <button disabled={busy} onClick={() => location.reload()}>
        {t('documentRefresh.reset')}
      </button>
      <p role="status">{message}</p>
      {state.result?.ok && state.result.failures.length > 0 && (
        <p>{t('documentRefresh.partial', { count: state.result.failures.length })}</p>
      )}
      {state.recoveryAvailable && (
        <div>
          <button disabled={busy} onClick={() => void refresh.recover()}>
            {t('documentRefresh.retry')}
          </button>{' '}
          <button
            onClick={() => {
              const bytes = refresh.recoveryBytes();
              if (!bytes) return;
              const url = URL.createObjectURL(new Blob([bytes]));
              const link = document.createElement('a');
              link.href = url;
              link.download = 'recovery.docx';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t('documentRefresh.download')}
          </button>
        </div>
      )}
      {state.changes.length > 0 && (
        <details open>
          <summary>{t('documentRefresh.reviewChanges')}</summary>
          <ul className="refresh-change-list">
            {state.changes.map((change) => (
              <li key={change.id}>
                <span>{change.description ?? change.id}</span>{' '}
                <span>{t(`documentRefresh.changeStatus.${change.status}`)}</span>{' '}
                {change.status === 'available' && (
                  <button
                    onClick={() => {
                      refresh.navigateToChange(change.id);
                      refresh.highlightChanges({ changeIds: [change.id], timeoutMs: 5000 });
                    }}
                  >
                    {t('documentRefresh.showChange')}
                  </button>
                )}
                {change.diagnostic && <code>{change.diagnostic.code}</code>}
              </li>
            ))}
          </ul>
        </details>
      )}
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
  if (!bytes) return <p role="status">{error || t('documentRefresh.loading')}</p>;
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
