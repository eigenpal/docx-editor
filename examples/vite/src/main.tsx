import './styles.css';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { PreviewBanner } from '../../shared/PreviewBanner';

const params = new URLSearchParams(location.search);
// `?treeFirst=1` mounts the CANONICAL TREE stack (bounded OPC read -> typed/generic tree ->
// TreeDocumentStore -> tree binding). It shares no code with the PackageModel path, so it is
// the surface that proves the replacement works before it becomes the default.
const treeFirst = params.get('treeFirst') === '1';
// `?paginated=1` keeps the packaged `PaginatedDocxEditorShell` harness
// reachable, for existing bookmarks and gates.
const paginated = params.get('paginated') === '1';
// The COMPOSED SURFACE is the default: the provider-first composition API
// (`DocxEditor.Root` / `.Toolbar` / `.Viewport` / `.Content` + the public hooks) as the
// flagship showcase. The one-surface harness, the diagnostic split pane
// (`?edit=1`) and the read-only engine preview (`?preview=engine`) are no
// longer part of this demo.
const composed = isDefaultSurface(params);

/** True when no explicit surface was asked for. */
function isDefaultSurface(search: URLSearchParams): boolean {
  return (
    search.get('museum') !== '1' && search.get('treeFirst') !== '1' && search.get('paginated') !== '1'
  );
}
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads. Sanitized to a
// bare .docx basename so the value can never become a path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
// The canonical comprehensive fixture (task M6D.1). Served straight from
// `e2e/fixtures/` by a vite plugin, so the demo and the e2e suite read the SAME bytes
// and a second copy cannot drift. `?fixture=` still overrides it.
const COMPREHENSIVE_FIXTURE = 'comprehensive-word-element-test.docx';
const defaultFixture = composed || paginated ? COMPREHENSIVE_FIXTURE : 'with-tables.docx';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : defaultFixture;

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    let view: ReactNode;
    if (composed) {
      const { ComposedEditorDemo } = await import('../../shared/ComposedEditorDemo.tsx');
      view = <ComposedEditorDemo fixtureUrl={`${base}${fixtureName}`} />;
    } else if (paginated) {
      const { PaginatedSurfaceDemo } = await import('../../shared/PaginatedSurfaceDemo.tsx');
      view = <PaginatedSurfaceDemo fixtureUrl={`${base}${fixtureName}`} />;
    } else if (treeFirst) {
      const { TreeSurfaceDemo } = await import('../../shared/TreeSurfaceDemo.tsx');
      view = <TreeSurfaceDemo fixtureUrl={`${base}${fixtureName}`} />;
    } else {
      // Legacy museum App — reference only, reachable at `?museum=1`. Never the
      // default and never a claim surface (see evidence/m4/demo-boundary.md).
      // @vite-ignore keeps vite's dependency scanner out of the full editor graph so
      // the paginated demo pre-bundles and loads independently of it.
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
