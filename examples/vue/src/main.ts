import { createApp } from 'vue';
import App from './App.vue';
import EnginePreview from '../../shared/EnginePreview.vue';
// Toolbar + dialog scoped styles ship as a separate file from the library
// bundle (Vite's lib mode doesn't auto-inject CSS imports). The
// alias-resolved dev path picks up SFC <style scoped> blocks via the Vue
// compiler, but the published-package parity build (USE_PUBLISHED_PACKAGES=true)
// needs this import or the toolbar renders unstyled.
import '@docx-editor.dev/vue/styles.css';

// `?preview=engine` opens the READ-ONLY production-engine preview (same shared
// projection + fixture as the React demo) instead of the full editor.
const enginePreview = new URLSearchParams(location.search).get('preview') === 'engine';
createApp(enginePreview ? EnginePreview : App, enginePreview ? { fixtureUrl: '/with-tables.docx' } : undefined).mount('#app');
