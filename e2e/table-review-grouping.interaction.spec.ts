import { expect, test } from '@playwright/test';
import { readZip, writeZip } from '../packages/core/src/store/package/zip.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../packages/core/src/store/__tests__/fixtures/review-table-grouping-cases.ts';
import { PAINTED_PAGE } from './painted-page.ts';

for (const name of ['nested-two-rows-ins', 'format-row-and-cells']) {
  for (const action of ['Accept', 'Reject']) {
    test(`${action} ${name}: rendered groups, undo, and save/reopen`, async ({
      page,
    }, testInfo) => {
      const fixture = reviewTableGroupingCases.find((entry) => entry.name === name)!;
      const bytes = writeZip(
        new Map(
          Object.entries(reviewTableGroupingParts(fixture)).map(([path, xml]) => [
            path,
            new TextEncoder().encode(xml),
          ])
        )
      );
      await page.route('**/table-grouping-e2e.docx', (route) =>
        route.fulfill({
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          body: Buffer.from(bytes),
        })
      );
      await page.goto('http://localhost:5273/?bulkReview=1&fixture=table-grouping-e2e.docx');
      const count = name === 'nested-two-rows-ins' ? 5 : 1;
      const status = page.getByRole('status', { name: 'Batch result' });
      await expect(status).toHaveText(`${count} changes shown.`);
      await expect(page.locator(PAINTED_PAGE).first()).toBeVisible();
      await expect(page.getByTestId('review-card')).toHaveCount(count);
      if (name === 'nested-two-rows-ins') {
        const cards = page.getByTestId('review-card');
        await expect(cards.nth(0)).toContainText('Added');
        await expect(cards.nth(0)).toContainText('First A');
        await expect(cards.nth(1)).toContainText('Added');
        await expect(cards.nth(1)).toContainText('First B');
        await expect(cards.nth(2)).toContainText('Inserted table row');
        await expect(cards.nth(3)).toContainText('Second B');
        await expect(cards.nth(4)).toContainText('Outer');
      }
      if (action === 'Accept') {
        await page.screenshot({ path: testInfo.outputPath('grouped-review.png'), fullPage: true });
      }
      await page.getByRole('button', { name: `${action} all changes shown`, exact: true }).click();
      await expect(status).toHaveText(`${count} resolved; 0 skipped; 0 remaining.`);
      await expect(page.getByTestId('review-card')).toHaveCount(0);
      await expect(
        page.locator('.docx-revision-insert, .docx-revision-delete, .docx-table-row--revision')
      ).toHaveCount(0);
      const saved = await page.evaluate(() => window.__DOCX_REVIEW_E2E__!.saveBytes());
      const archive = readZip(new Uint8Array(saved));
      if (!archive.ok) throw new Error(archive.reason);
      const xml = new TextDecoder().decode(archive.entries.get('/word/document.xml')!);
      expect(xml).not.toMatch(/<w:(?:ins|del|trPrChange|tcPrChange)\b/);
      if (name === 'nested-two-rows-ins') {
        expect(xml.match(/<w:tbl\b/g) ?? []).toHaveLength(action === 'Accept' ? 2 : 0);
        expect(xml.includes('First A')).toBe(action === 'Accept');
        if (action === 'Accept') await expect(page.locator('.docx-pages')).toContainText('First A');
        else await expect(page.locator('.docx-pages')).not.toContainText('First A');
      } else {
        expect(xml.includes('FFFF00')).toBe(action === 'Accept');
        expect(xml.includes('<w:trHeight')).toBe(action === 'Accept');
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(status).toHaveText(`${count} changes shown.`);
      await expect(page.getByTestId('review-card')).toHaveCount(count);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(status).toHaveText('0 changes shown.');
      await page.getByRole('button', { name: 'Save and reopen' }).click();
      await expect(status).toHaveText('0 changes shown.');
      await expect(page.getByTestId('review-card')).toHaveCount(0);
    });
  }
}
