import './styles.css';
import { createRoot } from 'react-dom/client';
import { PreviewBanner } from '../../shared/PreviewBanner';

// One surface: what a visitor sees is what a consumer installs.
const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;

// Served straight from `e2e/fixtures/` by a vite plugin, so the demo and the e2e suite
// read the SAME bytes and a second copy cannot drift.
const DEFAULT_FIXTURE = 'comprehensive-word-element-test.docx';

// `?fixture=<name>.docx` picks which same-origin fixture loads. Sanitized to a bare
// `.docx` basename so the value can never become a path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : DEFAULT_FIXTURE;

// `?treeFirst=1` is a Playwright harness, not a demo surface — see the header of
// `./test-harness/TreeSurfaceHarness`. Dynamically imported, so it stays out of the
// demo bundle.
const treeHarness = params.get('treeFirst') === '1';
// `?e2e=1` mounts the paginated React editor with `window.__DOCX_EDITOR_E2E__`.
const tableE2E = params.get('e2e') === '1';

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    const View = treeHarness
      ? (await import('./test-harness/TreeSurfaceHarness.tsx')).TreeSurfaceHarness
      : tableE2E
        ? (await import('./test-harness/TableEditingE2EHarness.tsx')).TableEditingE2EHarness
        : (await import('./ComposedEditorDemo.tsx')).ComposedEditorDemo;
    root.render(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <PreviewBanner />
        <View fixtureUrl={`${base}${fixtureName}`} />
      </div>
    );
  })();
}
