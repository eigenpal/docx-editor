import './styles.css';
import { createApp } from 'vue';

// The legacy one-surface harness (`?realAdapter=1`), the diagnostic split pane (`?edit=1`)
// and the read-only engine preview (`?preview=engine`) were deleted with the legacy editor
// lane. The Vue example now mounts the museum App only; the production Vue adapter is
// exercised by the paired host tests and the parity example.
void (async () => {
  const App = (await import('./App.vue')).default;
  createApp(App).mount('#app');
})();
