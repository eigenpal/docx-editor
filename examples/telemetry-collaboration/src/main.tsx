import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const host = document.querySelector<HTMLElement>('#root');
if (!host) throw new Error('missing #root');
// Editor styles are scoped to `.docx-editor` on an ancestor of the editor.
host.classList.add('docx-editor');

// No StrictMode here: in development it mounts every editor twice, and a telemetry demo would
// then count each open and each room join twice. Production builds mount once either way.
createRoot(host).render(<App />);
