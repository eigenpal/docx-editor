import { createRoot } from 'react-dom/client';
import { MarkdownExportDemo } from './MarkdownExportDemo';
import './styles.css';

const container = document.getElementById('app');
const embedded = new URLSearchParams(window.location.search).get('embed') === '1';
if (container) createRoot(container).render(<MarkdownExportDemo embedded={embedded} />);
