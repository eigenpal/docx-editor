/**
 * Parity spec: AgentPanel renders, accepts input, fires close events
 * symmetrically across React and Vue.
 */

import { forEachAdapter, openAgentPanel, expect } from './parity-fixture';

forEachAdapter('AgentPanel renders content area', async (adapter, { page }) => {
  await openAgentPanel(page, adapter);
  await expect(page.getByTestId('agent-panel-content')).toBeVisible();
});

forEachAdapter('AgentPanel close button hides the panel', async (adapter, { page }) => {
  await openAgentPanel(page, adapter);
  const panel = page.getByTestId('agent-panel');
  await expect(panel).toHaveAttribute('data-state', 'open');
  await page.getByTestId('agent-panel-close').click();
  await expect(panel).toHaveAttribute('data-state', 'closed');
});

forEachAdapter('AgentPanel resize handle is present and accessible', async (adapter, { page }) => {
  await openAgentPanel(page, adapter);
  const handle = page.getByTestId('agent-panel-resize-handle');
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
});
