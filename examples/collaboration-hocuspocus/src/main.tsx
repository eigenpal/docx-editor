import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyColorMode, initialColorMode } from './useColorMode';
import './styles.css';

const host = document.querySelector<HTMLElement>('#root');
if (!host) throw new Error('missing #root');

// Every editor style is scoped to `.docx-editor`, so the class has to be on an ANCESTOR of
// the editor. Never on the element that also carries Tailwind utilities — scoped utilities
// match descendants only.
// `docx-editor` scopes every editor style; `dark` is toggled at runtime by the theme switch
// in the room bar. Dark puts the WHOLE editor on the library's dark palette — chrome and the
// page, which the engine renders as Word's own dark page rather than a white sheet on a dark
// desk — and the demo's own frame follows the same switch.
host.classList.add('docx-editor');
// BEFORE the first render, and outside React: a remembered dark choice applied from inside a
// component would land one paint late, and only on the screens that mount the switch.
applyColorMode(initialColorMode());

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
);
