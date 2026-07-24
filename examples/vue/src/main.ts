import { createApp } from 'vue';

// `?preview=engine` opens the READ-ONLY production-engine preview instead of the full
// editor. Both are loaded via DYNAMIC import so the preview graph never pulls in
// ProseMirror or the legacy core; the fixture URL respects the deployment base.
const params = new URLSearchParams(location.search);
const enginePreview = params.get('preview') === 'engine';
const editMode = params.get('edit') === '1';
// `?realAdapter=1` mounts the PRODUCTION @docx-editor.dev/vue DocxEditor with DOCX bytes and exposes
// the stable EditorDriver on window (comprehensive 4.4/4.8), matching the React harness route.
const realAdapter = params.get('realAdapter') === '1';
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads (default
// with-tables.docx). Sanitized to a bare .docx basename so the value can never become a
// path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const defaultFixture = editMode || realAdapter ? 'editable-sample.docx' : 'with-tables.docx';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : defaultFixture;

void (async () => {
  if (realAdapter) {
    const DocxAdapterHarness = (await import('../../shared/DocxAdapterHarness.vue')).default;
    createApp(DocxAdapterHarness, { fixtureUrl: `${base}${fixtureName}` }).mount('#app');
  } else if (editMode) {
    const DocxEditable = (await import('../../shared/DocxEditable.vue')).default;
    createApp(DocxEditable, { fixtureUrl: `${base}${fixtureName}` }).mount('#app');
  } else if (enginePreview) {
    const EnginePreview = (await import('../../shared/EnginePreview.vue')).default;
    createApp(EnginePreview, { fixtureUrl: `${base}${fixtureName}` }).mount('#app');
  } else {
    // @vite-ignore keeps vite's dependency scanner out of the full editor graph so the
    // edit/preview modes pre-bundle and load independently of it.
    const App = (await import(/* @vite-ignore */ './App.vue')).default;
    createApp(App).mount('#app');
  }
})();
