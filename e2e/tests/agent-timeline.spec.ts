/**
 * E2E for the collapsible `<AgentTimeline>` primitive.
 *
 * The Vite demo opts into a tool-call fixture via `?agentTimeline=streaming`
 * (in-flight: expanded with spinner) or `?agentTimeline=done` (collapsed
 * "N steps" summary that re-expands on click).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function gotoTimeline(
  page: import('@playwright/test').Page,
  mode: 'streaming' | 'done' | 'long'
) {
  await page.goto(`/?e2e=1&agentPanel=1&agentTimeline=${mode}`);
  const editor = new EditorPage(page);
  await editor.waitForReady();
  // Open the panel via toolbar so the fixture renders.
  await page.getByRole('button', { name: 'Open assistant' }).click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
}

test.describe('AgentTimeline — streaming state', () => {
  test('renders an expanded timeline with the working summary while streaming', async ({
    page,
  }) => {
    await gotoTimeline(page, 'streaming');

    const timeline = page.getByTestId('agent-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText('Working');
    // The list of tool-call items is visible (i.e. expanded).
    await expect(timeline.locator('ol li')).toHaveCount(3);
    await expect(timeline).toContainText('Reading document');
    await expect(timeline).toContainText('Adding comment');
  });

  test('toggle button reports aria-expanded=true while streaming', async ({ page }) => {
    await gotoTimeline(page, 'streaming');
    const toggle = page.getByTestId('agent-timeline-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('AgentTimeline — done state', () => {
  test('auto-collapses to an "N steps" summary', async ({ page }) => {
    await gotoTimeline(page, 'done');

    const timeline = page.getByTestId('agent-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText('3 steps');
    // List is collapsed — no <ol> rendered.
    await expect(timeline.locator('ol')).toHaveCount(0);
  });

  test('clicking the summary re-expands the list', async ({ page }) => {
    await gotoTimeline(page, 'done');

    const toggle = page.getByTestId('agent-timeline-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('agent-timeline').locator('ol li')).toHaveCount(3);
  });

  test('done timeline shows the final assistant text bubble below', async ({ page }) => {
    await gotoTimeline(page, 'done');
    await expect(page.getByText('Done — left 3 comments.')).toBeVisible();
  });
});

test.describe('AgentTimeline — long turn cap', () => {
  test('caps the visible list to the most recent 3 calls + "earlier steps" header', async ({
    page,
  }) => {
    // 8-call fixture with cap = 3. Header should read "+ 5 earlier steps",
    // and only the last 3 calls render as items.
    await gotoTimeline(page, 'long');
    await page.getByTestId('agent-timeline-toggle').click();

    const timeline = page.getByTestId('agent-timeline');
    const earlier = timeline.getByTestId('agent-timeline-earlier');
    await expect(earlier).toBeVisible();
    await expect(earlier).toContainText('5 earlier steps');
    // 3 actual call items + 1 "earlier" placeholder line = 4 <li>.
    await expect(timeline.locator('ol li')).toHaveCount(4);
    // Headline still reflects the full count.
    await expect(timeline).toContainText('8 steps');
  });
});
