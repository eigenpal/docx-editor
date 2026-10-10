import { expect, test } from '@playwright/test';
import { connectedPeers, jumpToHeading, revealLocator } from './collaboration-review-helpers.ts';

test('joining peer paints inline and block images instead of placeholders', async ({
  browser,
  page: creator,
}) => {
  const paintErrors: string[] = [];
  const joiner = await connectedPeers(browser, creator);
  joiner.on('console', (message) => {
    if (message.type() === 'error') paintErrors.push(message.text());
  });

  await jumpToHeading(joiner, '10.1 Inline Images');
  const inlineParagraph = await revealLocator(
    joiner,
    joiner.locator('[data-paragraph-id]').filter({ hasText: /Inline:\s+red/ })
  );
  await expect(inlineParagraph.locator('.docx-drawing-ready img')).toHaveCount(4);
  await expect(inlineParagraph.locator('.docx-drawing-placeholder')).toHaveCount(0);
  await expect(inlineParagraph).not.toContainText('Invalid image');
  await expect(inlineParagraph).toContainText('red');
  await expect(inlineParagraph).toContainText('blue');

  await jumpToHeading(joiner, /10\.2 Block Image/);
  const caption = await revealLocator(
    joiner,
    joiner.locator('[data-paragraph-id]').filter({ hasText: /Figure 1: Test Banner/ })
  );
  await expect(caption).toBeVisible();
  await expect(joiner.locator('.docx-page-content .docx-drawing-placeholder')).toHaveCount(0);
  await expect(joiner.getByText('Invalid image')).toHaveCount(0);
  await expect(joiner.locator('.docx-drawing-placeholder-label')).toHaveCount(0);

  expect(paintErrors.filter((text) => text.includes('PaintImageUrlSource'))).toEqual([]);

  await jumpToHeading(joiner, /10\.3 Floating Image/);
  await revealLocator(joiner, joiner.getByText(/This text wraps around a floating image/));
  await expect(joiner.locator('.docx-drawing-layer .docx-drawing-ready img').first()).toBeVisible();
});
