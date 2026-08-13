import './styles.css';
import { createRoot } from 'react-dom/client';
import { PreviewBanner } from '../../shared/PreviewBanner';

// One surface: what a visitor sees is what a consumer installs.
const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;

// What a visitor sees by default is the demo document built by `scripts/demo-doc/build.ts`
// — the same content as the comprehensive fixture, rebranded and colour-tuned for public
// viewing. It ships in this app's `public/`, so it is served without the fixture plugin.
const DEFAULT_DOCUMENT = 'sample.docx';

// `?fixture=<name>.docx` swaps in a fixture instead, served straight from `e2e/fixtures/`
// by a vite plugin so the demo and the e2e suite read the SAME bytes. Sanitized to a bare
// `.docx` basename so the value can never become a path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const documentName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : DEFAULT_DOCUMENT;

// `?treeFirst=1` is a Playwright harness, not a demo surface — see the header of
// `./test-harness/TreeSurfaceHarness`. Dynamically imported, so it stays out of the
// demo bundle.
const treeHarness = params.get('treeFirst') === '1';
// `?e2e=1` mounts the paginated React editor with `window.__DOCX_EDITOR_E2E__`.
const tableE2E = params.get('e2e') === '1';
// `?perfE2e=1` mounts the same bridge with review-heavy production chrome for benchmarks.
const performanceE2E = params.get('perfE2e') === '1';

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  void (async () => {
    const View = treeHarness
      ? (await import('./test-harness/TreeSurfaceHarness.tsx')).TreeSurfaceHarness
      : performanceE2E
        ? (await import('./test-harness/PerformanceE2EHarness.tsx')).PerformanceE2EHarness
        : tableE2E
          ? (await import('./test-harness/TableEditingE2EHarness.tsx')).TableEditingE2EHarness
          : (await import('./ComposedEditorDemo.tsx')).ComposedEditorDemo;
    root.render(
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <PreviewBanner />
        <View fixtureUrl={`${base}${documentName}`} />
      </div>
    );
  })();
}
