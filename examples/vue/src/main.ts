import { createApp } from 'vue';
// Toolbar + dialog scoped styles ship as a separate file from the library
// bundle (Vite's lib mode doesn't auto-inject CSS imports). The
// alias-resolved dev path picks up SFC <style scoped> blocks via the Vue
// compiler, but the published-package parity build (USE_PUBLISHED_PACKAGES=true)
// needs this import or the toolbar renders unstyled.
import '@docx-editor.dev/vue/styles.css';

// `?preview=engine` opens the READ-ONLY production-engine preview instead of the full
// editor. Both are loaded via DYNAMIC import so the preview graph never pulls in
// ProseMirror or the legacy core; the fixture URL respects the deployment base.
const params = new URLSearchParams(location.search);
const enginePreview = params.get('preview') === 'engine';
const base = import.meta.env.BASE_URL;
// `?fixture=<name>.docx` picks which same-origin fixture the preview loads (default
// with-tables.docx). Sanitized to a bare .docx basename so the value can never become a
// path-traversal or cross-origin URL.
const fixtureParam = params.get('fixture') ?? '';
const fixtureName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : 'with-tables.docx';

void (async () => {
  if (enginePreview) {
    const EnginePreview = (await import('../../shared/EnginePreview.vue')).default;
    createApp(EnginePreview, { fixtureUrl: `${base}${fixtureName}` }).mount('#app');
  } else {
    const App = (await import('./App.vue')).default;
    createApp(App).mount('#app');
  }
})();
