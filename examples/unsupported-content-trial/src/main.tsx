import { createRoot } from 'react-dom/client';
import { createApp } from 'vue';
import ReactTrial from './ReactTrial';
import VueTrial from './VueTrial.vue';
import '@docx-editor.dev/react/styles.css';
import './style.css';
import fixture from '../public/custom-source.docx?url';
const response = await fetch(fixture);
const bytes = new Uint8Array(await response.arrayBuffer());
if (new URLSearchParams(location.search).get('framework') === 'vue') {
  createApp(VueTrial, { bytes }).mount('#app');
} else {
  createRoot(document.getElementById('app')!).render(<ReactTrial bytes={bytes} />);
}
