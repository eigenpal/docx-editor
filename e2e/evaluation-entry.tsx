/** The eval probe mounts the same React harness without loading demo routes. */
import { createRoot } from 'react-dom/client';
import '../examples/vite/src/styles.css';
import { TableEditingE2EHarness } from '../examples/vite/src/test-harness/TableEditingE2EHarness.tsx';

const container = document.getElementById('app');
if (!container) throw new Error('Missing evaluation mount');
createRoot(container).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <TableEditingE2EHarness fixtureUrl="/evaluation-input.docx" />
  </div>
);
