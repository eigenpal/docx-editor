/**
 * E2E for the right-hand AgentPanel: toolbar toggle, controlled open prop,
 * close button, drag-to-resize handle.
 *
 * The Vite demo opts the panel in via `?agentPanel=1` so production stays
 * unchanged. The render-prop returns a `data-testid="agent-panel-content"`
 * placeholder we can assert against.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function gotoWithPanel(page: import('@playwright/test').Page) {
  // Reuse EditorPage's plumbing for selectors / readiness, but override
  // the URL so the agent panel is enabled.
  await page.goto('/?e2e=1&agentPanel=1');
  const editor = new EditorPage(page);
  await editor.waitForReady();
}

test.describe('AgentPanel — toolbar toggle + close', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithPanel(page);
  });

  test('toolbar button toggles the panel open/closed', async ({ page }) => {
    // The panel is always mounted (so chat state survives toggling) but
    // starts collapsed via `data-state="closed"` and opacity 0.
    const panel = page.getByTestId('agent-panel');
    await expect(panel).toHaveAttribute('data-state', 'closed');

    // Click the toolbar toggle to open.
    const toggle = page.getByRole('button', { name: 'Open assistant' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(panel).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('agent-panel-content')).toBeVisible();

    // Click again to close.
    await toggle.click();
    await expect(panel).toHaveAttribute('data-state', 'closed');
  });

  test('close button dismisses the panel', async ({ page }) => {
    const panel = page.getByTestId('agent-panel');
    await page.getByRole('button', { name: 'Open assistant' }).click();
    await expect(panel).toHaveAttribute('data-state', 'open');

    await page.getByTestId('agent-panel-close').click();
    await expect(panel).toHaveAttribute('data-state', 'closed');
  });

  test('render-prop close handle dismisses the panel', async ({ page }) => {
    const panel = page.getByTestId('agent-panel');
    await page.getByRole('button', { name: 'Open assistant' }).click();
    await page.getByRole('button', { name: 'Close from inside' }).click();
    await expect(panel).toHaveAttribute('data-state', 'closed');
  });

  test('renders the consumer-supplied content', async ({ page }) => {
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const panel = page.getByTestId('agent-panel');
    await expect(panel).toContainText('BYO chat goes here.');
  });

  test('drag handle resizes the panel within min/max bounds', async ({ page }) => {
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const panel = page.getByTestId('agent-panel');
    await expect(panel).toHaveAttribute('data-state', 'open');

    // Wait for the open transition to settle so the initial bounding box
    // reflects the panel's resting width, not a mid-transition value.
    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0, { timeout: 2000 })
      .toBeGreaterThan(300);

    const initialBox = await panel.boundingBox();
    expect(initialBox).not.toBeNull();
    const startWidth = initialBox!.width;

    const handle = page.getByTestId('agent-panel-resize-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Drag the handle 100px left → width should grow by ~100px.
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 10 });
    await page.mouse.up();

    const finalBox = await panel.boundingBox();
    expect(finalBox).not.toBeNull();
    expect(finalBox!.width).toBeGreaterThan(startWidth + 60);
    expect(finalBox!.width).toBeLessThan(startWidth + 140);
  });
});

test.describe('AgentPanel — does not render without prop', () => {
  test('toolbar toggle is absent and panel is not in the DOM', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto(); // no ?agentPanel=1
    await editor.waitForReady();

    await expect(page.getByRole('button', { name: 'Open assistant' })).toHaveCount(0);
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
  });
});
