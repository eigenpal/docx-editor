// Exercise the real stylesheet: DOM-only paint tests cannot see pseudo-element bars
// or CSS outlines. Geometry and revision attribution are covered by the core tests.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('../packages/core/src/styles/editor.css', import.meta.url),
  'utf8'
);
const iglooCss = readFileSync(new URL('../examples/igloo/src/igloo.css', import.meta.url), 'utf8');

for (const theme of ['light', 'dark', 'igloo']) {
  test(`${theme}: rows and drawings use only the shared revision bar`, async ({ page }) => {
    await page.setContent(`
      <div class="docx-editor ${theme === 'dark' ? 'dark' : ''}">
        <div class="${theme === 'igloo' ? 'igloo-page' : ''}">
          <div class="docx-table-row--revision layout-revision-ins">Inserted row</div>
          <div class="docx-table-row--revision layout-revision-del">Deleted row</div>
          <div class="docx-drawing docx-drawing--revision docx-drawing--revision-insertion">Inserted drawing</div>
          <div class="docx-drawing docx-drawing--revision docx-drawing--revision-deletion">Deleted drawing</div>
          <div class="docx-change-bars">
            <div class="docx-change-bar" style="background-color:var(--doc-review-change-bar)"></div>
          </div>
        </div>
      </div>`);
    await page.addStyleTag({ content: css });
    if (theme === 'igloo') await page.addStyleTag({ content: iglooCss });
    for (const row of await page.locator('.docx-table-row--revision').all()) {
      for (const pseudo of ['::before', '::after']) {
        expect(await row.evaluate((el, p) => getComputedStyle(el, p).content, pseudo)).toBe('none');
      }
    }
    for (const drawing of await page.locator('.docx-drawing').all()) {
      await expect(drawing).toHaveCSS('outline-style', 'none');
      await expect(drawing).toHaveCSS('box-shadow', 'none');
    }
    await expect(page.locator('.docx-drawing--revision-deletion')).toHaveCSS('opacity', '0.6');
    const bar = page.locator('.docx-change-bar');
    await expect(bar).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(158, 158, 158)' : 'rgb(164, 164, 164)'
    );
    await bar.evaluate((el: HTMLElement) => {
      el.style.backgroundColor = 'var(--doc-review-change-bar-simple)';
    });
    await expect(bar).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(240, 82, 74)' : 'rgb(234, 52, 37)'
    );
  });
}
