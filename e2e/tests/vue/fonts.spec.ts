import { test, expect } from '@playwright/test';

test.describe('Vue: custom font registration via fonts prop', () => {
  test('injects @font-face when fonts prop is supplied', async ({ page }) => {
    await page.goto('http://localhost:5174/?e2e=1&customFonts=1');
    await page.waitForSelector('.docx-editor-vue', { timeout: 10000 });
    await page.waitForFunction(() => document.fonts.ready);

    const styleText = await page.evaluate(() => {
      const styles = Array.from(document.head.querySelectorAll('style'));
      return styles.map((s) => s.textContent || '').join('\n');
    });
    expect(styleText).toContain('font-family: "E2E Custom Font"');
    expect(styleText).toContain('font-weight: normal');
    expect(styleText).toContain('font-weight: 700');
  });

  test('registers the custom face on document.fonts', async ({ page }) => {
    await page.goto('http://localhost:5174/?e2e=1&customFonts=1');
    await page.waitForSelector('.docx-editor-vue', { timeout: 10000 });
    await page.waitForFunction(() => document.fonts.ready);

    const families = await page.evaluate(() =>
      Array.from(document.fonts).map((f) => f.family.replace(/^["']|["']$/g, ''))
    );
    expect(families).toContain('E2E Custom Font');
  });

  test('custom font actually loads and renders distinct glyphs', async ({ page }) => {
    await page.goto('http://localhost:5174/?e2e=1&customFonts=1');
    await page.waitForSelector('.docx-editor-vue', { timeout: 10000 });
    await page.waitForFunction(() => document.fonts.ready);

    const status = await page.evaluate(async () => {
      const face = Array.from(document.fonts).find(
        (f) => f.family.replace(/^["']|["']$/g, '') === 'E2E Custom Font'
      );
      if (!face) return 'missing';
      await face.load();
      return face.status;
    });
    expect(status).toBe('loaded');

    const widths = await page.evaluate(() => {
      const sample = 'Custom font sample 1234567890';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = '72px monospace';
      const monospace = ctx.measureText(sample).width;
      ctx.font = '72px "E2E Custom Font", monospace';
      const custom = ctx.measureText(sample).width;
      return { monospace, custom };
    });
    expect(widths.custom).not.toBe(widths.monospace);
  });
});
