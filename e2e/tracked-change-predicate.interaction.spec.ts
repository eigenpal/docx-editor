import { expect, test } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const URL = 'http://localhost:5273/?perfE2e=1&fixture=reviewer-filter.docx';

async function savedDigest(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
    const digest = await crypto.subtle.digest('SHA-256', await editor.save());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  });
}

test('a full-data predicate controls tracked markup and review cards without changing DOCX', async ({
  page,
}) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('performance-e2e-mount')).toBeVisible();
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.ready() === true);
  const before = await savedDigest(page);

  const evaluated = await page.evaluate(() => {
    const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
    const seen: Array<{
      author: string;
      date: string | null;
      revisionKind: string;
      text: string;
      partName: string | null;
    }> = [];
    editor.setTrackedChangesFilter((revision) => {
      seen.push({
        author: revision.author,
        date: revision.date ?? null,
        revisionKind: revision.revisionKind,
        text: revision.text,
        partName: revision.ranges[0]?.partName ?? null,
      });
      return revision.author === 'Bob Editor' && revision.revisionKind === 'insert';
    });
    return seen;
  });

  expect(evaluated).toHaveLength(4);
  expect(evaluated.every((revision) => revision.partName === '/word/document.xml')).toBe(true);
  expect(evaluated.some((revision) => revision.text === 'BOB_INSERT')).toBe(true);
  await expect(page.locator('.docx-revision-insert[data-review-author="Bob Editor"]')).toHaveCount(
    1
  );
  await expect(
    page.locator('.docx-revision-insert[data-review-author="Alice Reviewer"]')
  ).toHaveCount(0);
  await expect(page.locator('.docx-revision-delete')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="review-card"][data-review-author="Bob Editor"][data-kind="insert"]')
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="review-card"][data-kind="insert"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="review-card"][data-kind="comment"]')).toHaveCount(2);
  await expect(page.locator('.docx-pages')).toContainText('ALICE_INSERT');
  await expect(page.locator('.docx-pages')).not.toContainText('ALICE_DELETE');
  expect(await savedDigest(page)).toBe(before);

  await page.evaluate(() => {
    window
      .__DOCX_EDITOR_E2E__!.getEditor()!
      .setTrackedChangesFilter(
        (revision) => revision.author === 'Bob Editor' && revision.revisionKind === 'insert',
        'reject'
      );
  });
  await expect(page.locator('.docx-revision-insert[data-review-author="Bob Editor"]')).toHaveCount(
    1
  );
  await expect(page.locator('.docx-revision-delete')).toHaveCount(0);
  await expect(page.locator('.docx-pages')).not.toContainText('ALICE_INSERT');
  await expect(page.locator('.docx-pages')).toContainText('ALICE_DELETE');
  expect(await savedDigest(page)).toBe(before);

  await page.evaluate(() => {
    window.__DOCX_EDITOR_E2E__!.getEditor()!.setTrackedChangesFilter(null);
  });
  await expect(page.locator('[data-testid="review-card"]')).toHaveCount(6);
});
