import { expect, test, type Page } from '@playwright/test';
import {
  connectedPeers,
  documentXml,
  firstTableCellParagraph,
  firstTextParagraph,
  paintedHeader,
  paragraphById,
  paragraphs,
  revealLocator,
  savePackageBytes,
  setEditingMode,
} from './collaboration-review-helpers.ts';

const HEADER = 'review-header-demo.docx';
const TABLE = 'table-cell-selection-drag.docx';

async function dragCellRectangle(page: Page): Promise<void> {
  const cells = page.locator(
    '.docx-table-cell:not([data-v-merge-continue]) .docx-paragraph-fragment[data-paragraph-id]'
  );
  const first = await revealLocator(page, cells.nth(0));
  const last = await revealLocator(page, cells.nth(3));
  const start = await first.boundingBox();
  const end = await last.boundingBox();
  if (!start || !end) throw new Error('cell boxes missing');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('a table cell rectangle paints presence on the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, TABLE);
  await firstTableCellParagraph(creator);
  await dragCellRectangle(creator);
  await expect(creator.locator('.docx-cell-selection-rect').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(joiner.locator('.docx-remote-selection-rect').first()).toBeVisible({
    timeout: 20_000,
  });
  expect(await joiner.locator('.docx-remote-selection-rect').count()).toBeGreaterThan(1);
  await expect(
    joiner.locator('.docx-remote-caret-label').filter({ hasText: 'Alice' })
  ).toBeVisible();
});

test('a caret in a header paints presence on the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, HEADER);
  const header = paintedHeader(creator);
  await expect(header).toBeVisible();
  await header.dblclick();
  await expect(creator.locator('[data-docx-hf-active][data-docx-hf="header"]')).toBeVisible({
    timeout: 20_000,
  });
  const paragraph = creator.locator('[data-docx-hf="header"] [data-paragraph-id]').first();
  await expect(paragraph).toBeVisible();
  await paragraph.click();
  await creator.keyboard.press('Home');
  await expect(joiner.locator('.docx-remote-caret-label').filter({ hasText: 'Alice' })).toBeVisible(
    {
      timeout: 20_000,
    }
  );
  const overlay = joiner.locator('.docx-remote-caret, .docx-remote-selection-rect').first();
  await expect(overlay).toBeVisible();
  const remoteHeader = await paintedHeader(joiner).boundingBox();
  const painted = await overlay.boundingBox();
  expect(remoteHeader).toBeTruthy();
  expect(painted).toBeTruthy();
  expect(painted!.y).toBeLessThan(remoteHeader!.y + remoteHeader!.height);
  expect(painted!.y + painted!.height).toBeGreaterThan(remoteHeader!.y);
});

test('a viewing peer receives edits, and its clicks do not move its presence', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator);
  // Joining leaves the room dialog open over the toolbar.
  const room = joiner.getByRole('dialog', { name: 'Collaboration room' });
  if (await room.isVisible()) await room.getByRole('button', { name: 'Done' }).click();
  await expect(room).toHaveCount(0);
  await setEditingMode(joiner, 'viewing');

  const source = await firstTextParagraph(creator);
  const marker = ' [A]';
  await source.locator.click();
  await creator.keyboard.press('End');
  await creator.keyboard.type(marker);
  const remote = paragraphById(joiner, source.id);
  await expect(remote).toContainText(`${source.text}${marker}`);

  // Whatever the creator shows for the viewer before the presses, it shows after them too.
  const bobOnCreator = creator.locator('.docx-remote-caret-label').filter({ hasText: 'Bob' });
  const presence = async () =>
    (await bobOnCreator.count()) === 0 ? null : await bobOnCreator.first().boundingBox();
  const before = await presence();
  const other = paragraphs(joiner).filter({ hasText: /\S/ }).nth(2);
  await expect(other).toBeVisible();
  await other.click();
  await other.dblclick();
  await joiner.waitForTimeout(1_500);
  expect(await presence()).toEqual(before);

  // Back in editing, the same peer edits and both replicas converge.
  await setEditingMode(joiner, 'editing');
  await remote.click();
  await joiner.keyboard.press('End');
  await joiner.keyboard.type(' [B]');
  await expect(source.locator).toContainText(`${source.text}${marker} [B]`);
  expect(documentXml(await savePackageBytes(joiner))).toBe(
    documentXml(await savePackageBytes(creator))
  );
});
