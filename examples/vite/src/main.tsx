import './styles.css';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { PreviewBanner } from '../../shared/PreviewBanner';

// `?preview=engine` opens the READ-ONLY production-engine preview (parse -> layout ->
// display) instead of the full editor. The editor and preview are loaded via DYNAMIC
// import so the preview graph never pulls in ProseMirror or the legacy core, and the
// fixture URL respects the deployment base (e.g. /react/).
const params = new URLSearchParams(location.search);
const enginePreview = params.get('preview') === 'engine';
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads (default
// with-tables.docx). Sanitized to a bare .docx basename so the value can never become a
// path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : 'with-tables.docx';

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    let view: ReactNode;
    if (enginePreview) {
      const { EnginePreview } = await import('../../shared/EnginePreview');
      view = <EnginePreview fixtureUrl={`${base}${fixtureName}`} />;
    } else {
      const { App } = await import('./App');
      view = <App />;
    }
    root.render(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <PreviewBanner />
        {view}
      </div>,
    );
  })();
}
