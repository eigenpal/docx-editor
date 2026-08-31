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

for (const adapter of ADAPTERS) {
  test(`${adapter.name} filters markup, document flow, and review cards by author`, async ({
    page,
  }) => {
    await waitForEditor(page, adapter.url);
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

    const trigger = page.getByTestId('reviewers-trigger');
    await trigger.click();
    const menu = page.getByTestId('reviewers-menu');
    await expect(menu).toHaveCSS('overflow-y', 'auto');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    await trigger.click();
    const all = page.getByTestId('reviewer-all');
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
