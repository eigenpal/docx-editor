import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';

for (const action of ['Accept', 'Reject']) {
  test(`${action} shown, explicit batches, undo, redo, and save/reopen`, async ({ page }) => {
    await page.goto('http://localhost:5273/?bulkReview=1&fixture=bulk-review.docx');
    const pending = page.getByRole('group', { name: 'Pending revisions' });
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('4 changes shown.');
    await page.getByLabel('Author', { exact: true }).selectOption('Ada');
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('2 changes shown.');
    await page.getByRole('button', { name: `${action} all changes shown`, exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText(
      '2 resolved; 0 skipped; 2 remaining.'
    );
    const saved = await page.evaluate(() => window.__DOCX_REVIEW_E2E__!.saveBytes());
    const xml = strFromU8(unzipSync(new Uint8Array(saved))['word/document.xml']!);
    expect(xml.includes('Ada first')).toBe(action === 'Accept');
    expect(xml.includes('Ada offscreen')).toBe(action === 'Accept');
    expect(xml).toContain('Grace hidden');
    expect(xml.match(/<w:ins\b/g)).toHaveLength(2);
    await page.getByLabel('Author', { exact: true }).selectOption('all');
    await expect(pending).toContainText('Grace hidden');
    await expect(pending).not.toContainText('Ada first');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('4 changes shown.');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('2 changes shown.');
    await page.getByRole('button', { name: 'Save and reopen' }).click();
    await expect(pending).toContainText('Grace hidden');
    await expect(pending).toContainText('(unsupported)');
    await pending.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: `${action} selected`, exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText(
      '1 resolved; 0 skipped; 1 remaining.'
    );
    await expect(
      page.getByRole('button', { name: `${action} all changes shown`, exact: true })
    ).toBeDisabled();
    await expect(pending).toContainText('(unsupported)');
  });
  test(`${action} API main story reports unsupported changes after reopening`, async ({ page }) => {
    await page.goto('http://localhost:5273/?bulkReview=1&fixture=bulk-review.docx');
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('4 changes shown.');
    await page.getByLabel('Author', { exact: true }).selectOption('Ada');
    await page.getByRole('button', { name: `${action} main story (API)`, exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText(
      '3 resolved; 1 skipped; 1 remaining.'
    );
    await page.getByLabel('Author', { exact: true }).selectOption('all');
    await expect(page.getByRole('group', { name: 'Pending revisions' })).toContainText(
      '(unsupported)'
    );
    await page.getByRole('button', { name: 'Save and reopen' }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText('1 changes shown.');
    await page.getByRole('button', { name: `${action} main story (API)`, exact: true }).click();
    await expect(page.getByRole('status', { name: 'Batch result' })).toHaveText(
      '0 resolved; 1 skipped; 1 remaining.'
    );
  });
}
