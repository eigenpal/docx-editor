import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Help menu', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
  });

  test('Help > Report issue opens GitHub issues URL with pre-filled body', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __lastOpenedUrl?: string }).__lastOpenedUrl = undefined;
      window.open = ((url?: string | URL) => {
        (window as unknown as { __lastOpenedUrl?: string }).__lastOpenedUrl = String(url ?? '');
        return null;
      }) as typeof window.open;
    });

    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'Report issue' }).click();

    const openedUrl = await page.evaluate(
      () => (window as unknown as { __lastOpenedUrl?: string }).__lastOpenedUrl
    );
    expect(openedUrl).toBeDefined();

    const url = new URL(openedUrl!);
    expect(url.origin + url.pathname).toBe('https://github.com/eigenpal/docx-editor/issues/new');

    expect(url.searchParams.get('title')).toBe('[Bug] ');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('Steps to reproduce');
    expect(body).toContain('Attach the DOCX');
    expect(body).toContain('User agent:');
    expect(body).toContain('Viewport:');
  });
});
