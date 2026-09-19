import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createT, en } from '@docx-editor.dev/i18n';
const t = createT(en);
import './style.css';
type Diagnostic = { code: string; message: string; pageIndex?: number };
function App() {
  const [file, setFile] = useState<File>();
  const [view, setView] = useState('proposed');
  const [comments, setComments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [pdf, setPdf] = useState('');
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    []
  );
  useEffect(
    () => () => {
      if (pdf) URL.revokeObjectURL(pdf);
    },
    [pdf]
  );
  function reset() {
    version.current++;
    controller.current?.abort();
    setBusy(false);
    setPdf('');
    setError('');
    setRetry(false);
    setDiagnostics([]);
  }
  async function convert(bestEffort = false) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError(t('pdfDemo.limit'));
      return;
    }
    const current = ++version.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setRetry(false);
    setPdf('');
    setDiagnostics([]);
    try {
      const response = await fetch(
        `/api/convert?displayMode=${view}&comments=${comments}&fidelityPolicy=${bestEffort ? 'best-effort' : 'strict'}`,
        { method: 'POST', body: file, signal: abort.signal }
      );
      const result = await response.json();
      if (current !== version.current) return;
      setDiagnostics(result.diagnostics ?? []);
      if (!response.ok) {
        setError(result.message ?? t('pdfDemo.failed'));
        setRetry(response.status === 422);
        return;
      }
      const raw = atob(result.pdf),
        bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      setPdf(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    } catch {
      if (current === version.current)
        setError(abort.signal.aborted ? t('pdfDemo.aborted') : t('pdfDemo.failed'));
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  async function sample() {
    reset();
    const current = version.current;
    try {
      const response = await fetch('/sample.docx');
      if (!response.ok) throw new Error();
      const bytes = await response.blob();
      if (current === version.current) setFile(new File([bytes], 'sample.docx'));
    } catch {
      if (current === version.current) setError(t('pdfDemo.failed'));
    }
  }
  return (
    <main>
      <section className="controls">
        <p className="brand">EigenPal</p>
        <h1>{t('pdfDemo.title')}</h1>
        <p>{t('pdfDemo.description')}</p>
        <label className="upload">
          {t('pdfDemo.choose')}
          <input
            type="file"
            accept=".docx"
            disabled={busy}
            onChange={(e) => {
              reset();
              setFile(e.target.files?.[0]);
            }}
          />
        </label>
        <button className="secondary" disabled={busy} onClick={() => void sample()}>
          {t('pdfDemo.sample')}
        </button>
        {file && (
          <p className="filename" aria-label={t('pdfDemo.selected')}>
            {file.name}
          </p>
        )}
        <label>
          {t('pdfDemo.view')}
          <select
            disabled={busy}
            value={view}
            onChange={(e) => {
              reset();
              setView(e.target.value);
            }}
          >
            <option value="proposed">{t('pdfDemo.proposed')}</option>
            <option value="original">{t('pdfDemo.original')}</option>
            <option value="all-markup">{t('pdfDemo.markup')}</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={comments}
            disabled={busy}
            onChange={(e) => {
              reset();
              setComments(e.target.checked);
            }}
          />
          {t('pdfDemo.comments')}
        </label>
        <p className="hint">{t('pdfDemo.strict')}</p>
        <button disabled={!file || busy} onClick={() => void convert()}>
          {busy ? t('pdfDemo.busy') : t('pdfDemo.convert')}
        </button>
        {busy && (
          <button className="secondary" onClick={() => controller.current?.abort()}>
            {t('pdfDemo.cancel')}
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {retry && (
          <button className="secondary" onClick={() => void convert(true)}>
            {t('pdfDemo.retry')}
          </button>
        )}
        {pdf && (
          <a
            className="download"
            href={pdf}
            download={(file?.name.replace(/\.docx$/i, '') ?? 'document') + '.pdf'}
          >
            {t('pdfDemo.download')}
          </a>
        )}
        {diagnostics.length > 0 && (
          <details open>
            <summary>{t('pdfDemo.diagnostics')}</summary>
            <ul>
              {diagnostics.map((d, i) => (
                <li key={i}>
                  {d.message}
                  {d.pageIndex === undefined ? '' : ` (${d.pageIndex + 1})`}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="hint">{t('pdfDemo.upload')}</p>
      </section>
      <section className="preview" aria-label={t('pdfDemo.preview')}>
        {pdf ? <iframe title={t('pdfDemo.preview')} src={pdf} /> : <p>{t('pdfDemo.empty')}</p>}
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
