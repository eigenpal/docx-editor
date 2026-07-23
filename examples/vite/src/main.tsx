import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PreviewBanner } from '../../shared/PreviewBanner';
import { EnginePreview } from '../../shared/EnginePreview';

// `?preview=engine` opens the READ-ONLY production-engine preview (parse -> layout ->
// display, no ProseMirror/legacy-core) instead of the full editor. Same fixture and
// shared projection as the Vue demo.
const enginePreview = new URLSearchParams(location.search).get('preview') === 'engine';

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <PreviewBanner />
      {enginePreview ? <EnginePreview fixtureUrl="/with-tables.docx" /> : <App />}
    </div>
  );
}
