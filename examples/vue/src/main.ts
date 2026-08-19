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
    setup() {
      const fixtureUrl = `${base}${documentName}`;
      return () =>
        h('div', { style: 'display: flex; flex-direction: column; height: 100vh' }, [
          h(PreviewBanner),
          h(ComposedEditorDemo, { fixtureUrl }),
        ]);
    },
  }).mount('#app');
})();
