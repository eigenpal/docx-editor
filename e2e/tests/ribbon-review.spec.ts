import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Review tab', () => {
  test('shows comments toggle and editing mode control', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await page.getByRole('tab', { name: 'Review' }).click();

    const ribbon = page.getByTestId('ribbon');
    await expect(ribbon).toHaveAttribute('data-has-toggle-comments', 'true');
    const showCommentsButton = ribbon.getByRole('button', { name: 'Show Comments' });
    await expect(showCommentsButton).toBeVisible();
    await expect(showCommentsButton).toBeEnabled();
    await expect(page.getByTestId('editing-mode-dropdown')).toBeVisible();

    const editor = page.getByTestId('docx-editor');
    const initialState = (await editor.getAttribute('data-comments-open')) ?? 'false';

    await showCommentsButton.click();
    const expected = initialState === 'true' ? 'false' : 'true';
    await expect(editor).toHaveAttribute('data-comments-open', expected);
  });

  test('new comment opens sidebar at cursor when no selection', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await editor.focus();
    await editor.typeText('Comment here');
    await page.getByRole('tab', { name: 'Review' }).click();

    await page.getByTestId('ribbon-reviewNewComment').click();

    const editorRoot = page.getByTestId('docx-editor');
    await expect(editorRoot).toHaveAttribute('data-comments-open', 'true');
    await expect(page.getByPlaceholder('Add a comment...')).toBeVisible();
  });

  test('delete comment removes the selected comment', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await editor.focus();
    await editor.typeText('Delete me');
    const selected = await editor.selectText('Delete me');
    expect(selected).toBe(true);

    const commentCards = page.locator('.docx-comment-card');
    const commentMarks = page.locator('.paged-editor__pages [data-comment-id]');
    const initialCardCount = await commentCards.count();
    const initialMarkCount = await commentMarks.count();

    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByTestId('ribbon-reviewNewComment').click();

    const sidebar = page.locator('.docx-comments-sidebar');
    const commentInput = sidebar.getByPlaceholder('Add a comment...');
    await commentInput.fill('Test comment');
    await sidebar.getByRole('button', { name: 'Comment' }).click();

    await expect(commentCards).toHaveCount(initialCardCount + 1);
    const afterMarkCount = await commentMarks.count();
    expect(afterMarkCount).toBeGreaterThan(initialMarkCount);

    await editor.selectText('Delete me');
    await page.getByTestId('ribbon-reviewDelete').click();

    await expect(commentCards).toHaveCount(initialCardCount);
    const finalMarkCount = await commentMarks.count();
    expect(finalMarkCount).toBeLessThan(afterMarkCount);
  });
});
