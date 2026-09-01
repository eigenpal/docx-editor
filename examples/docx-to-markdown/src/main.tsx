import { createRoot } from 'react-dom/client';
import { MarkdownExportDemo } from './MarkdownExportDemo';
import './styles.css';

const container = document.getElementById('app');
if (container) createRoot(container).render(<MarkdownExportDemo />);
