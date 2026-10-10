import { expect, test } from '@playwright/test';
import { readZip, writeZip } from '../packages/core/src/store/package/zip.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../packages/core/src/store/__tests__/fixtures/review-table-grouping-cases.ts';
import { PAINTED_PAGE } from './painted-page.ts';

for (const name of [
  'nested-two-rows-ins',
  'format-row-and-cells',
  'format-one-cell',
  'format-separated-rows',
  'word-created-nested-row-ins',
  'word-created-nested-row-del',
  'format-grid-with-gap',
  'move-range-pair',
  'move-range-wrapper-destination',
  'word-created-table-width',
  'word-created-row-height',
  'word-created-table-alignment',
]) {
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
      const count =
        name === 'nested-two-rows-ins'
          ? 5
          : [
                'format-grid-with-gap',
                'format-separated-rows',
                'move-range-wrapper-destination',
              ].includes(name)
            ? 2
            : name === 'move-range-pair'
              ? 4
              : 1;
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
      } else if (name.startsWith('word-created-nested-row-')) {
        await expect(page.getByTestId('review-card')).toContainText(
          name.endsWith('-ins') ? 'Inserted table row' : 'Deleted table row'
        );
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
      } else if (name.startsWith('word-created-nested-row-')) {
        const inserted = name.endsWith('-ins');
        const removed = inserted ? action === 'Reject' : action === 'Accept';
        expect(xml.match(/<w:tr[\s>]/g) ?? []).toHaveLength(
          inserted ? (removed ? 3 : 4) : removed ? 2 : 3
        );
        if (inserted) expect(xml.includes('Word added cell')).toBe(!removed);
        else expect(xml.includes('First A')).toBe(!removed);
        for (const text of ['Second A', 'Second B', 'Outer', 'Neighbour'])
          expect(xml).toContain(text);
        await expect(page.locator('.docx-pages')).toContainText('Second A');
      } else if (name === 'move-range-wrapper-destination') {
        expect(xml).toContain('>Destination<');
        expect(xml).not.toMatch(/<w:moveTo(?:RangeStart|RangeEnd)?\b/);
      } else if (name === 'move-range-pair') {
        expect(xml.includes('>Moved<')).toBe(action === 'Accept');
        expect(xml).not.toMatch(/<w:move(?:From|To)Range/);
      } else if (name === 'word-created-table-alignment') {
        expect(xml).not.toMatch(/<w:\w+Change\b/);
        expect([...xml.matchAll(/<w:jc\b[^>]*w:val="([^"]+)"/g)].map((m) => m[1])).toEqual(
          action === 'Accept' ? ['center', 'center'] : []
        );
      } else if (name === 'word-created-row-height') {
        expect(xml).not.toMatch(/<w:\w+Change\b/);
        expect(xml.includes('<w:trHeight')).toBe(action === 'Accept');
      } else if (name === 'word-created-table-width') {
        expect(xml).not.toMatch(/<w:\w+Change\b/);
        expect(
          [...xml.matchAll(/<w:tcW[^>]*w:w="(\d+)"/g)].map((match) => Number(match[1]))
        ).toEqual([2000, action === 'Accept' ? 1600 : 2000, 2000, 2000, 2000, 2000, 2000, 2000]);
      } else if (name === 'format-grid-with-gap') {
        expect(xml).not.toContain('<w:tblGridChange');
        expect(xml.includes('<w:trHeight')).toBe(action === 'Accept');
      } else if (name === 'format-one-cell') {
        expect(xml.includes('FFFF00')).toBe(action === 'Accept');
        expect(xml.includes('w:type="auto"')).toBe(action === 'Reject');
      } else if (name === 'format-separated-rows') {
        expect(xml.includes('<w:trHeight')).toBe(action === 'Accept');
        expect(xml.includes('<w:gridAfter')).toBe(action === 'Reject');
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

for (const [name, action, count] of [
  ['nested-plain-ins', 'Reject', 1],
  ['nested-plain-del', 'Accept', 1],
  ['nested-opposite-row-ins', 'Reject', 4],
  ['nested-opposite-row-del', 'Accept', 4],
] as const) {
  test(`${action} ${name}: retain the nested table and report the pending decision`, async ({
    page,
  }) => {
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
    const status = page.getByRole('status', { name: 'Batch result' });
    await expect(status).toHaveText(`${count} changes shown.`);
    await expect(page.getByTestId('review-card')).toHaveCount(count);
    await page.getByRole('button', { name: `${action} all changes shown`, exact: true }).click();
    await expect(status).toHaveText(`${count - 1} resolved; 1 skipped; 1 remaining.`);
    await expect(page.getByTestId('review-card')).toHaveCount(1);
    const text = name.includes('plain') ? 'Existing A' : 'Nested A';
    await expect(page.locator('.docx-pages')).toContainText(text);
    await expect(page.locator('.docx-pages')).not.toContainText('Neighbour');
    const saved = await page.evaluate(() => window.__DOCX_REVIEW_E2E__!.saveBytes());
    const archive = readZip(new Uint8Array(saved));
    if (!archive.ok) throw Error(archive.reason);
    const xml = new TextDecoder().decode(archive.entries.get('/word/document.xml')!);
    expect(xml.match(/<w:tbl\b/g)).toHaveLength(2);
    expect(xml.match(/<w:(?:ins|del)\b/g)).toHaveLength(1);
    expect(xml).toContain(text);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(status).toHaveText(`${count} changes shown.`);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(status).toHaveText('1 changes shown.');
    await page.getByRole('button', { name: 'Save and reopen' }).click();
    await expect(page.getByTestId('review-card')).toHaveCount(1);
    await expect(page.locator('.docx-pages')).toContainText(text);
  });
}
