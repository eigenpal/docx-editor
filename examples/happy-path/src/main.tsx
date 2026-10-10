import { createRoot } from 'react-dom/client';
import { HappyPath } from './HappyPath';

const container = document.getElementById('app');
if (container) createRoot(container).render(<HappyPath />);
