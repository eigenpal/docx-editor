import { expect, test } from '@playwright/test';

const DEMO_URL = 'http://localhost:5273/';

test('detached server bytes stay isolated until the explicit live handoff', async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.docx-page').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Show detached server automation recipe' }).click();
  const recipe = page.getByTestId('server-automation-recipe');
  await recipe.getByRole('button', { name: 'Prepare detached result' }).click();
  await expect(
    recipe.getByText('Detached bytes are ready. The live document is still unchanged.')
  ).toBeVisible({ timeout: 30_000 });

  const prepared = JSON.parse((await recipe.locator('pre').textContent()) ?? '{}');
  expect(prepared.liveDocumentUnchangedBeforeExplicitLoad).toBe(true);
  expect(prepared.byteOwnership.inputBufferMayBeReusedAfterCreateServer).toBe(true);
  expect(prepared.byteOwnership.eachSaveReturnsCallerOwnedBytes).toBe(true);
  expect(prepared.saveReopen.matchesDetachedResult).toBe(true);
  expect(prepared.expectedErrors.unloaded.actual).toBe('PropertyNotLoaded');
  expect(prepared.expectedErrors.disposed.actual).toBe('RuntimeDisposed');
  expect(prepared.expectedErrors.stale.actual).toBe('StaleDocument');
  expect(prepared.capabilities.server).toEqual({
    document: true,
    save: true,
    events: true,
    selection: false,
    scrolling: false,
    layout: false,
  });

  await recipe.getByRole('button', { name: 'Load result into live editor' }).click();
  await expect(
    recipe.getByText('The detached bytes were explicitly loaded into the live editor.')
  ).toBeVisible({ timeout: 30_000 });
  const loaded = JSON.parse((await recipe.locator('pre').textContent()) ?? '{}');
  expect(loaded.explicitLoad.loadedMatchesDetachedResult).toBe(true);
});
