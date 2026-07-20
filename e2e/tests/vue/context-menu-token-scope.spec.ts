/**
 * Regression: the Vue context menu (and other body-teleported chrome) renders
 * into <body>, OUTSIDE the editor's `.ep-root` where the `--doc-*` color tokens
 * live. Without re-applying that scope the menu resolves every token to empty
 * and paints unstyled (transparent, no border/shadow). The teleported root now
 * carries the editor's `.ep-root` (+ theme) class, so the tokens resolve.
 */
import { test, expect } from '@playwright/test';

test('Vue: body-teleported context menu inherits the --doc-* token scope', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]');

  // Right-click a body paragraph to open the context menu.
  const para = page.locator('.layout-page-content .layout-paragraph').first();
  await para.click({ button: 'right' });
  await page.waitForSelector('.ctx-menu', { state: 'visible', timeout: 5000 });

  const style = await page.evaluate(() => {
    const menu = document.querySelector('.ctx-menu') as HTMLElement | null;
    if (!menu) return null;
    const cs = getComputedStyle(menu);
    return {
      inBody: menu.parentElement?.tagName === 'BODY',
      hasEpRoot: menu.classList.contains('ep-root'),
      surfaceToken: cs.getPropertyValue('--doc-surface').trim(),
      backgroundColor: cs.backgroundColor,
      borderTopWidth: cs.borderTopWidth,
    };
  });

  expect(style).not.toBeNull();
  // Still teleported to <body> (so it escapes any transformed/overflow ancestor)...
  expect(style!.inBody).toBe(true);
  // ...but re-scoped so the tokens resolve and the box is actually painted.
  expect(style!.hasEpRoot).toBe(true);
  expect(style!.surfaceToken).not.toBe('');
  expect(style!.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style!.backgroundColor).not.toBe('transparent');
  expect(parseFloat(style!.borderTopWidth)).toBeGreaterThan(0);
});
