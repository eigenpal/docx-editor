import './igloo.css';
import { createRoot } from 'react-dom/client';
import { IglooEditor } from './IglooEditor';

const base = import.meta.env.BASE_URL;

// The SAME document the Vite example opens, served from its `public/` by a vite plugin so
// the two demos and the e2e suite read one set of bytes and no copy can drift.
const DEFAULT_FIXTURE = 'sample.docx';

// `?fixture=<name>.docx` picks which same-origin fixture loads. Sanitized to a bare `.docx`
// basename, so the value can never become a path traversal or a cross-origin URL.
const requested = new URLSearchParams(location.search).get('fixture') ?? '';
const fixture = /^[\w.-]+\.docx$/.test(requested) ? requested : DEFAULT_FIXTURE;

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<IglooEditor fixtureUrl={`${base}${fixture}`} />);
}
