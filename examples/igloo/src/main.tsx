import './igloo.css';
import { createRoot } from 'react-dom/client';
import { IglooEditor } from './IglooEditor';

const base = import.meta.env.BASE_URL;

// Served straight from `e2e/fixtures/` by a vite plugin, so the demo and the e2e suite read
// the SAME bytes and a second copy cannot drift.
const DEFAULT_FIXTURE = 'comprehensive-word-element-test.docx';

// `?fixture=<name>.docx` picks which same-origin fixture loads. Sanitized to a bare `.docx`
// basename, so the value can never become a path traversal or a cross-origin URL.
const requested = new URLSearchParams(location.search).get('fixture') ?? '';
const fixture = /^[\w.-]+\.docx$/.test(requested) ? requested : DEFAULT_FIXTURE;

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<IglooEditor fixtureUrl={`${base}${fixture}`} />);
}
