/**
 * Parity spec: AgentTimeline renders identically against the React and
 * Vue demos. Drives the same `?agentTimeline=…` fixture against both.
 *
 * Each `forEachAdapter` block emits one test per adapter
 * (`… [react]`, `… [vue]`). They run in the dedicated `parity`
 * Playwright project (see playwright.config.ts) which boots both demo
 * dev servers.
 */

import { forEachAdapter, openAgentPanel, expect } from './parity-fixture';
import type { Page } from '@playwright/test';
import type { AdapterFixture } from './parity-fixture';

async function gotoTimeline(
  page: Page,
  adapter: AdapterFixture,
  mode: 'streaming' | 'done' | 'long'
): Promise<void> {
  await openAgentPanel(page, adapter, `&agentTimeline=${mode}`);
  await expect(page.getByTestId('agent-timeline')).toBeVisible();
}

forEachAdapter(
  'AgentTimeline streaming — expanded with working summary and call rows',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'streaming');
    const timeline = page.getByTestId('agent-timeline');
    await expect(timeline).toContainText('Working');
    await expect(timeline.locator('ol li')).toHaveCount(3);
    await expect(timeline).toContainText('Reading document');
    await expect(timeline).toContainText('Adding comment');
  }
);

forEachAdapter(
  'AgentTimeline streaming — toggle reports aria-expanded=true',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'streaming');
    await expect(page.getByTestId('agent-timeline-toggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  }
);

forEachAdapter(
  'AgentTimeline done — auto-collapses to "N steps" summary',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'done');
    const timeline = page.getByTestId('agent-timeline');
    await expect(timeline).toContainText('3 steps');
    await expect(timeline.locator('ol')).toHaveCount(0);
  }
);

forEachAdapter(
  'AgentTimeline done — clicking summary re-expands list',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'done');
    const toggle = page.getByTestId('agent-timeline-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('agent-timeline').locator('ol li')).toHaveCount(3);
  }
);

forEachAdapter(
  'AgentTimeline done — final assistant text bubble is visible',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'done');
    await expect(page.getByText('Done — left 3 comments.')).toBeVisible();
  }
);

forEachAdapter(
  'AgentTimeline long — caps to 3 visible + "earlier steps" header',
  async (adapter, { page }) => {
    await gotoTimeline(page, adapter, 'long');
    await page.getByTestId('agent-timeline-toggle').click();
    const timeline = page.getByTestId('agent-timeline');
    const earlier = timeline.getByTestId('agent-timeline-earlier');
    await expect(earlier).toContainText('5 earlier steps');
    await expect(timeline.locator('ol li')).toHaveCount(4);
    await expect(timeline).toContainText('8 steps');
  }
);
