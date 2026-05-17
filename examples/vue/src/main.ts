import { createApp } from 'vue';
import App from './App.vue';
// Toolbar + dialog scoped styles ship as a separate file from the library
// bundle (Vite's lib mode doesn't auto-inject CSS imports). The
// alias-resolved dev path picks up SFC <style scoped> blocks via the Vue
// compiler, but the published-package parity build (USE_PUBLISHED_PACKAGES=true)
// needs this import or the toolbar renders unstyled.
import '@eigenpal/docx-editor-vue/styles.css';

createApp(App).mount('#app');
