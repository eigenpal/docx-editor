import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('toolbar hook wiring keeps core actions functional', async ({ page }) => {
  const editor = new EditorPage(page);
  await page.goto('/?toolbar=ribbon');
  await editor.waitForReady();
  await editor.selectText('Project Charter');
  await page.keyboard.press('ArrowRight');
  await editor.clickRibbonButton('bold');
  await editor.typeText('Hook');
  expect(await editor.expectTextBold('Hook')).toBe(true);
});
