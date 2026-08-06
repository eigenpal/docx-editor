import './igloo.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IglooEditor } from './IglooEditor';

const base = import.meta.env.BASE_URL;

// This demo's own copy of the sample, with an iceberg and an igloo already in it, so the
// custom nodes and their rail cards are on screen before anyone touches a menu. It lives in
// `public/` rather than behind the fixture plugin because nothing else reads it. The shared
// `sample.docx` still comes through the plugin, under `?fixture=`.
const DEFAULT_FIXTURE = 'sample-igloo.docx';

// `?fixture=<name>.docx` picks which same-origin fixture loads. Sanitized to a bare `.docx`
// basename, so the value can never become a path traversal or a cross-origin URL.
const requested = new URLSearchParams(location.search).get('fixture') ?? '';
const fixture = /^[\w.-]+\.docx$/.test(requested) ? requested : DEFAULT_FIXTURE;

const container = document.getElementById('app');
if (container) {
  // StrictMode, because the library asks its hosts to survive it: `DocxEditor.Root`
  // documents itself as StrictMode-safe, and a demo that skipped it would stop proving that.
  createRoot(container).render(
    <StrictMode>
      <IglooEditor fixtureUrl={`${base}${fixture}`} />
    </StrictMode>
  );
}
