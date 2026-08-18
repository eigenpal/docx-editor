import './styles.css';
import { createApp, h } from 'vue';
import PreviewBanner from '../../shared/PreviewBanner.vue';

const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;
const DEFAULT_DOCUMENT = 'sample.docx';
const fixtureParam = params.get('fixture') ?? '';
const documentName = /^[\w.-]+\.docx$/.test(fixtureParam) ? fixtureParam : DEFAULT_DOCUMENT;

void (async () => {
  const ComposedEditorDemo = (await import('./ComposedEditorDemo.vue')).default;
  createApp({
    components: { PreviewBanner, ComposedEditorDemo },
    template: `
      <div style="display: flex; flex-direction: column; height: 100vh">
        <PreviewBanner />
        <ComposedEditorDemo :fixture-url="fixtureUrl" />
      </div>
    `,
    setup() {
      return { fixtureUrl: `${base}${documentName}` };
    },
  }).mount('#app');
})();
