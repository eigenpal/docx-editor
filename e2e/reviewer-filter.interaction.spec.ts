import { expect, test, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const FIXTURE = 'reviewer-filter.docx';
const ADAPTERS = [
  { name: 'React', url: `http://localhost:5273/?fixture=${FIXTURE}` },
  { name: 'Vue', url: `http://localhost:5274/?fixture=${FIXTURE}` },
] as const;

async function waitForEditor(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('composed-mount')).toBeVisible();
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
}

async function openReviewerMenu(page: Page) {
  const review = page.getByRole('menuitem', { name: 'Review', exact: true });
  if ((await review.getAttribute('aria-expanded')) !== 'true') await review.click();
  await page.getByRole('menuitem', { name: 'Markup Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reviewers', exact: true }).click();
  return page.getByRole('menu', { name: 'Reviewers', exact: true });
}

for (const adapter of ADAPTERS) {
  test(`${adapter.name} review settings preserve choices and restore defaults`, async ({
    page,
  }) => {
    await waitForEditor(page, adapter.url);
    const trigger = page.getByRole('button', { name: 'Review settings', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Review display' });
    await expect(dialog).toBeVisible();
    const panelId = await dialog.getAttribute('id');
    expect(panelId).toBeTruthy();
    await expect(trigger).toHaveAttribute('aria-controls', panelId!);
    const trackedChanges = dialog.getByRole('radio', {
      name: 'Tracked change balloons',
      exact: true,
    });
    await expect(trackedChanges).toBeChecked();
    await expect(trackedChanges).toBeFocused();
    await dialog.getByRole('radio', { name: 'Review pane', exact: true }).check();
    await dialog.getByRole('radio', { name: 'Icon', exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
    await trigger.click();
    await expect(dialog.getByRole('radio', { name: 'Review pane', exact: true })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Icon', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(trackedChanges).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Initials', exact: true })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Manual', exact: true })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Float', exact: true })).toBeChecked();
    expect(
      await page.evaluate(() => localStorage.getItem('docx-editor-demo.review-pane'))
    ).toBeNull();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const panelBox = await dialog.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
    await dialog.getByRole('radio', { name: 'Review pane', exact: true }).check();
    await expect(dialog.getByRole('radio', { name: 'Review pane', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test(`${adapter.name} filters markup, document flow, and review cards by author`, async ({
    page,
  }) => {
    await waitForEditor(page, adapter.url);
    // These assertions exercise sidebar cards. The example starts with tracked change balloons.
    await page.getByRole('button', { name: 'Review settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Review display' });
    await settings.getByRole('radio', { name: 'Review pane', exact: true }).check();
    await settings.getByRole('button', { name: 'Close review settings' }).click();
    const rail = page.getByTestId('review-rail');
    if (!(await rail.evaluate((node) => node.hasAttribute('data-open')))) {
      await page.locator('.docx-toolbar [data-slot="review.comments"]').first().click();
    }
    await expect(rail).toHaveAttribute('data-open', '');
    const pages = page.locator('.docx-pages');
    const aliceMarkup = page.locator(
      '.docx-revision-insert[data-review-author="Alice Reviewer"], .docx-revision-delete[data-review-author="Alice Reviewer"]'
    );
    const bobMarkup = page.locator(
      '.docx-revision-insert[data-review-author="Bob Editor"], .docx-revision-delete[data-review-author="Bob Editor"]'
    );

    await expect(aliceMarkup).toHaveCount(2);
    await expect(bobMarkup).toHaveCount(2);
    await expect(pages).toContainText('ALICE_DELETE');

    const menu = await openReviewerMenu(page);
    await expect(menu).toHaveCSS('overflow-y', 'auto');
    await pages.click({ position: { x: 2, y: 2 } });
    await expect(menu).toHaveCount(0);

    await openReviewerMenu(page);
    const all = page.locator('[data-slot="reviewer-all"]');
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await all.click();
    await expect(aliceMarkup).toHaveCount(0);
    await expect(bobMarkup).toHaveCount(0);
    await expect(pages).not.toContainText('ALICE_DELETE');
    await all.click();
    await expect(aliceMarkup).toHaveCount(2);
    await expect(bobMarkup).toHaveCount(2);

    const alice = page.getByRole('menuitemcheckbox', { name: 'Alice Reviewer' });
    await expect(alice).toHaveAttribute('aria-checked', 'true');
    await alice.click();

    await expect(alice).toHaveAttribute('aria-checked', 'false');
    await expect(aliceMarkup).toHaveCount(0);
    await expect(bobMarkup).toHaveCount(2);
    await expect(pages).toContainText('ALICE_INSERT');
    await expect(pages).not.toContainText('ALICE_DELETE');
    await expect(
      page.locator('[data-testid="review-card"][data-review-author="Alice Reviewer"]')
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="review-card"][data-review-author="Bob Editor"]')
    ).not.toHaveCount(0);

    await all.click();
    await expect(aliceMarkup).toHaveCount(2);
    await expect(pages).toContainText('ALICE_DELETE');
  });
}
