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
const editMode = params.get('edit') === '1';
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads (default
// with-tables.docx). Sanitized to a bare .docx basename so the value can never become a
// path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const defaultFixture = editMode ? 'editable-sample.docx' : 'with-tables.docx';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : defaultFixture;

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    let view: ReactNode;
    if (editMode) {
      const { DocxEditable } = await import('../../shared/DocxEditable.tsx');
      view = <DocxEditable fixtureUrl={`${base}${fixtureName}`} />;
    } else if (enginePreview) {
      // Explicit .tsx: on a case-insensitive filesystem an extensionless import of
      // `EnginePreview` resolves to the sibling `enginePreview.ts` (the render helper,
      // which has no `EnginePreview` export) before the `.tsx` component.
      const { EnginePreview } = await import('../../shared/EnginePreview.tsx');
      view = <EnginePreview fixtureUrl={`${base}${fixtureName}`} />;
    } else {
      // @vite-ignore keeps vite's dependency scanner out of the full editor graph so
      // the read-only engine preview pre-bundles and loads independently of it.
      const { App } = await import(/* @vite-ignore */ './App');
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
