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
const browserFirst = params.get('browserFirst') === '1';
// `?realAdapter=1` mounts the PRODUCTION @docx-editor.dev/react DocxEditor with DOCX bytes and
// exposes the stable EditorDriver on window (comprehensive 4.4/4.8), so a browser test drives the
// real published package entry rather than the engine mount directly.
// The one-surface editor is now the DEFAULT (task 6.6): `/` mounts it with no
// query parameter. `?realAdapter=1` still works so existing gates and bookmarks
// keep resolving, but it is no longer required. The museum surfaces stay
// reachable only by their explicit opt-in parameters below.
const legacyMuseum = params.get('museum') === '1';
const realAdapter = !enginePreview && !editMode && !legacyMuseum;
const zoomParam = params.get('zoom');
const initialZoom = zoomParam && Number.isFinite(Number(zoomParam)) && Number(zoomParam) > 0 ? Number(zoomParam) : 1;
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads (default
// with-tables.docx). Sanitized to a bare .docx basename so the value can never become a
// path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
// The canonical comprehensive fixture (task M6D.1). Served straight from
// `e2e/fixtures/` by a vite plugin, so the demo and the e2e suite read the SAME bytes
// and a second copy cannot drift. `?fixture=` still overrides it.
const COMPREHENSIVE_FIXTURE = 'comprehensive-word-element-test.docx';
const defaultFixture = browserFirst
  ? 'editable-sample.docx'
  : editMode || realAdapter
    ? COMPREHENSIVE_FIXTURE
    : 'with-tables.docx';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : defaultFixture;

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    let view: ReactNode;
    // ── Demo surface boundary (interactive-paginated-editing M4.7) ──────────
    // `?realAdapter=1` is the ONE-SURFACE editor: the production adapter with
    // the polished shell, and the only surface any interaction claim is made
    // about. `?edit=1` is the DIAGNOSTIC split edit/preview pane — it proves
    // the model pipeline, never painted-page interaction, and task 6.6 removes
    // it from normal startup. `?preview=engine` is the read-only engine preview
    // and `?museum=1` is the legacy museum, both reference-only. The bare `/`
    // default IS the one-surface editor (task 6.6 landed); anything that is not
    // an explicit opt-out falls through to it.
    if (realAdapter) {
      const { DocxAdapterHarness } = await import('../../shared/DocxAdapterHarness.tsx');
      view = <DocxAdapterHarness fixtureUrl={`${base}${fixtureName}`} initialZoom={initialZoom} />;
    } else if (editMode) {
      const { DocxEditable } = await import('../../shared/DocxEditable.tsx');
      view = <DocxEditable fixtureUrl={`${base}${fixtureName}`} />;
    } else if (enginePreview) {
      // Explicit .tsx: on a case-insensitive filesystem an extensionless import of
      // `EnginePreview` resolves to the sibling `enginePreview.ts` (the render helper,
      // which has no `EnginePreview` export) before the `.tsx` component.
      const { EnginePreview } = await import('../../shared/EnginePreview.tsx');
      view = <EnginePreview fixtureUrl={`${base}${fixtureName}`} />;
    } else {
      // Legacy museum App — reference only, reachable at `?museum=1`. Never the
      // default and never a claim surface (see evidence/m4/demo-boundary.md).
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
