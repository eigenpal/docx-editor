/**
 * Helpers for tracked-change sidebar cards in Playwright tests.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Ensure a tracked-change card is expanded so Accept/Reject are in the DOM.
 *
 * Caret landing on a tracked mark auto-expands the matching card
 * (`DocxEditor` selection handler). Blindly clicking the card then toggles
 * it closed and the subsequent Accept/Reject click fails. Only click when
 * the actions are not already rendered.
 */
export async function ensureTrackedChangeCardExpanded(
  page: Page,
  card?: Locator
): Promise<Locator> {
  const target = card ?? page.locator('.docx-tracked-change-card').first();
  const accept = target.locator('button[title="Accept"]');
  if ((await accept.count()) === 0) {
    await target.click();
  }
  await expect(accept.first()).toBeVisible({ timeout: 5000 });
  return target;
}
