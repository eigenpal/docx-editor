import './styles.css';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { PreviewBanner } from '../../shared/PreviewBanner';

// ONE editor. The demo mounts `ComposedEditorDemo` — the provider-first composition API
// (`DocxEditor.Root` / `.Toolbar` / `.Viewport` / `.Content` plus the public hooks) — and
// nothing else. There is no surface picker: the legacy museum app, the paginated-shell
// harness, the diagnostic split pane and the read-only engine preview are all gone, so
// what a visitor sees is what a consumer installs.
const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;

// The canonical comprehensive fixture. Served straight from `e2e/fixtures/` by a vite
// plugin, so the demo and the e2e suite read the SAME bytes and a second copy cannot drift.
const DEFAULT_FIXTURE = 'comprehensive-word-element-test.docx';

// `?fixture=<name>.docx` picks which same-origin fixture loads. Sanitized to a bare
// `.docx` basename so the value can never become a path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : DEFAULT_FIXTURE;

// `?treeFirst=1` is a PLAYWRIGHT HARNESS, not a demo surface: it mounts the canonical
// tree stack (`openTreeSession` + `mountTreeSurface`) bare, with no chrome and no layout
// claim, so `e2e/browser-first-tree.smoke.spec.ts` can drive the tree binding directly.
// Deliberately undiscoverable from the demo UI.
const treeHarness = params.get('treeFirst') === '1';

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    let view: ReactNode;
    if (treeHarness) {
      const { TreeSurfaceHarness } = await import('./test-harness/TreeSurfaceHarness.tsx');
      view = <TreeSurfaceHarness fixtureUrl={`${base}${fixtureName}`} />;
    } else {
      const { ComposedEditorDemo } = await import('./ComposedEditorDemo.tsx');
      view = <ComposedEditorDemo fixtureUrl={`${base}${fixtureName}`} />;
    }
    root.render(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <PreviewBanner />
        {view}
      </div>
    );
  })();
}
