import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { commentEditFixture } from './comment-edit-fixture';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

declare global {
  interface Window {
    __commentEdit: Editor;
  }
}
async function open(page: Page, adapter: string, port: number) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${port}/?fixture=review-clean-demo.docx`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.docx-pages[contenteditable]').first().waitFor();
  await page.evaluate(
    async ({ base, adapter, bytes }) => {
      const { mountCommentEditor } = await import(`${base}/e2e/comment-edit-${adapter}-harness.ts`);
      window.__commentEdit = await mountCommentEditor(new Uint8Array(bytes));
      if (!window.__commentEdit.isReviewPaneOpen())
        window.__commentEdit.exec({ type: 'toggleReviewPane' });
    },
    { base: `/@fs/${resolve(import.meta.dirname, '..')}`, adapter, bytes: commentEditFixture() }
  );
  const marker = page.getByRole('button', {
    name: 'Show comments: Demo Reviewer. Original comment.',
  });
  if (await marker.count()) await marker.click();
  await expect(page.getByTestId('review-comment-actions').first()).toBeVisible();
}
const ownCard = (page: Page) =>
  page.getByTestId('review-card').filter({ hasText: 'Original comment.' });
async function commentText(page: Page) {
  return page.evaluate(
    () =>
      window.__commentEdit
        .getReviewItems()
        .find((x) => x.kind === 'comment' && x.author === 'Demo Reviewer')?.text
  );
}
for (const [adapter, port] of [
  ['react', 5273],
  ['vue', 5274],
] as const) {
  test.describe(`${adapter} comment editing`, () => {
    test.beforeEach(async ({ page }) => open(page, adapter, port));
    test('save keeps its primary color on hover and disabled states stay stable', async ({
      page,
    }) => {
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      const save = page.getByRole('button', { name: 'Save changes', exact: true });
      const background = () => save.evaluate((button) => getComputedStyle(button).backgroundColor);
      const disabledBackground = await background();
      await save.hover({ force: true });
      await expect.poll(background).toBe(disabledBackground);
      await page.getByTestId('review-edit-input').fill('Updated comment.');
      await expect(save).toBeEnabled();
      const expectedHover = await save.evaluate((button) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--doc-primary-hover)';
        button.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await save.hover();
      await expect.poll(background).toBe(expectedHover);
      await expect(save).toHaveCSS('opacity', '1');
      await page.screenshot({
        path: test.info().outputPath('comment-save-hover.png'),
        animations: 'disabled',
      });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await commentText(page)).toBe('Original comment.');
    });
    test('mouse save, multiline, undo/redo, and save/reopen retain comment identity', async ({
      page,
    }) => {
      const before = await page.evaluate(() =>
        window.__commentEdit.getReviewItems().map((x) => ({ key: x.key, author: x.author }))
      );
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      const field = page.getByTestId('review-edit-input');
      await expect(field).toBeFocused();
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      await field.fill('Edited comment.\nSecond line.');
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath('comment-edit-desktop.png'),
      });
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect.poll(() => commentText(page)).toBe('Edited comment.\nSecond line.');
      await expect(page.getByTestId('review-comment-actions').first()).toBeFocused();
      await page.evaluate(() => window.__commentEdit.exec({ type: 'undo' }));
      await expect.poll(() => commentText(page)).toBe('Original comment.');
      await page.evaluate(() => window.__commentEdit.exec({ type: 'redo' }));
      await expect.poll(() => commentText(page)).toBe('Edited comment.\nSecond line.');
      await page.evaluate(async () => {
        const bytes = await window.__commentEdit.save();
        await window.__commentEdit.load(bytes);
      });
      await expect.poll(() => commentText(page)).toBe('Edited comment.\nSecond line.');
      expect(
        await page.evaluate(() =>
          window.__commentEdit.getReviewItems().map((x) => ({ key: x.key, author: x.author }))
        )
      ).toEqual(before);
    });
    test('keyboard cancel and save, empty input, and IME preserve the draft', async ({ page }) => {
      await ownCard(page).getByTestId('review-comment-actions').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      const field = page.getByTestId('review-edit-input');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Discard this');
      await expect(field).toHaveValue('Discard this');
      await expect(page.locator('.docx-pages')).toContainText('Review this paragraph.');
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
      expect(await commentText(page)).toBe('Original comment.');
      await expect(page.getByTestId('review-comment-actions').first()).toBeFocused();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await field.fill('   ');
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      await field.fill('Keep composition');
      await field.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
      await expect(field).toHaveValue('Keep composition');
      expect(await commentText(page)).toBe('Original comment.');
      await field.press('ControlOrMeta+Enter');
      await expect.poll(() => commentText(page)).toBe('Keep composition');
    });
    test('mouse Edit routes select-all, typing, and clipboard paste into the draft only', async ({
      page,
      context,
    }) => {
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      const field = page.getByTestId('review-edit-input');
      await expect(field).toBeFocused();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Keyboard edit');
      await expect(field).toHaveValue('Keyboard edit');
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('Pasted draft'));
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('ControlOrMeta+V');
      await expect(field).toHaveValue('Pasted draft');
      await expect(page.locator('.docx-pages')).toContainText('Review this paragraph.');
      expect(await commentText(page)).toBe('Original comment.');
    });
    test('draft survives a closed card and a viewing-mode change', async ({ page }) => {
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      await page.getByTestId('review-edit-input').fill('Unsaved draft');
      await page.getByRole('button', { name: 'Comment actions', exact: true }).first().click();
      await page.getByTestId('review-edit').click();
      await expect(page.getByTestId('review-edit-input')).toBeFocused();
      await expect(page.getByTestId('review-edit-input')).toHaveValue('Unsaved draft');
      await page.evaluate(() => window.__commentEdit.exec({ type: 'toggleReviewPane' }));
      await expect(page.getByTestId('review-edit-input')).toHaveCount(0);
      await page.evaluate(() => window.__commentEdit.exec({ type: 'toggleReviewPane' }));
      await expect(page.getByTestId('review-edit-input')).toHaveValue('Unsaved draft');
      await page.evaluate(() =>
        window.__commentEdit.exec({ type: 'setEditingMode', mode: 'viewing' })
      );
      await expect(page.getByTestId('review-edit-input')).toHaveValue('Unsaved draft');
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      await page.evaluate(() =>
        window.__commentEdit.exec({ type: 'setEditingMode', mode: 'editing' })
      );
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    });
    test('deleted comments leave a recoverable draft without recreating the comment', async ({
      page,
    }) => {
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      await page.getByTestId('review-edit-input').fill('Do not lose this draft');
      await page.evaluate(() => {
        const editor = window.__commentEdit;
        const item = editor.getReviewItems().find((x) => x.text === 'Original comment.')!;
        editor.deleteReviewItem(item.key);
      });
      const recovery = page.getByTestId('review-draft-recovery');
      await expect(recovery).toBeVisible();
      await expect(recovery.getByRole('textbox')).toHaveValue('Do not lose this draft');
      await expect(recovery.getByRole('textbox')).toHaveAttribute('readonly', '');
      expect(await commentText(page)).toBeUndefined();
      await recovery.getByRole('button', { name: 'Discard draft' }).click();
      await expect(recovery).toHaveCount(0);
    });
    test('narrow cards retain long multiline text and visible edit controls', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      const field = page.getByTestId('review-edit-input');
      await field.fill('First line.\n' + 'Longword'.repeat(25));
      for (const name of ['Save changes', 'Cancel']) {
        const button = page.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        await expect.poll(async () => (await button.boundingBox())!.x).toBeGreaterThanOrEqual(0);
        await expect
          .poll(async () => {
            const bounds = (await button.boundingBox())!;
            return bounds.x + bounds.width;
          })
          .toBeLessThanOrEqual(390);
        await expect
          .poll(async () => {
            const bounds = (await button.boundingBox())!;
            return bounds.y + bounds.height;
          })
          .toBeLessThanOrEqual(844);
      }
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath('comment-edit-narrow-form.png'),
      });
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      const text = page
        .getByTestId('review-card')
        .filter({ hasText: 'First line.' })
        .locator('.docx-review__text')
        .first();
      await expect(text).toHaveCSS('white-space', 'pre-wrap');
      const box = await text.boundingBox();
      expect(box!.height).toBeGreaterThan(35);
      const edit = page.getByTestId('review-comment-actions').first();
      const editBox = await edit.boundingBox();
      expect(editBox!.x).toBeGreaterThanOrEqual(0);
      expect(editBox!.x + editBox!.width).toBeLessThanOrEqual(390);
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath('comment-edit-narrow.png'),
      });
      await edit.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath('comment-edit-narrow-menu.png'),
      });
    });
    test('unsupported comment bodies retain the draft after a refused save', async ({ page }) => {
      await page.evaluate(async (bytes) => {
        await window.__commentEdit.load(new Uint8Array(bytes));
      }, commentEditFixture(true));
      await page.getByTestId('review-comment-actions').first().click();
      await page.getByTestId('review-edit').click();
      await page.getByTestId('review-edit-input').fill('Keep refused draft');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByTestId('review-edit-input')).toHaveValue('Keep refused draft');
      expect(await commentText(page)).toBe('Original comment.');
      await expect(page.getByRole('status')).toContainText('Could not save');
    });
    test('foreign comments and viewing mode cannot be edited', async ({ page }) => {
      const foreign = page.getByTestId('review-card').filter({ hasText: 'Other comment.' });
      await foreign.getByTestId('review-comment-actions').click();
      await expect(page.getByTestId('review-edit')).toHaveCount(0);
      await expect(page.getByTestId('review-delete')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.evaluate(() =>
        window.__commentEdit.exec({ type: 'setEditingMode', mode: 'viewing' })
      );
      for (const trigger of await page.getByTestId('review-comment-actions').all())
        await expect(trigger).toBeDisabled();
    });
    test('actions menu supports keyboard dismissal and deletes only the selected reply', async ({
      page,
    }) => {
      const trigger = ownCard(page).getByTestId('review-comment-actions');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('review-edit')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('review-delete')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.evaluate(() => {
        const e = window.__commentEdit;
        const root = e.getReviewItems().find((x) => x.text === 'Original comment.')!;
        e.replyToReviewItem(root.key, 'Reply to remove.');
      });
      await page.getByRole('button', { name: 'Reply actions', exact: true }).click();
      await page.getByTestId('review-delete').click();
      await expect(page.getByTestId('review-reply')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
        .toBe('review-comment-actions');
      expect(await commentText(page)).toBe('Original comment.');
      await trigger.click();
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath('comment-actions-menu.png'),
      });
      await page.getByTestId('review-delete').click();
      expect(await commentText(page)).toBeUndefined();
      await expect(page.locator('.docx-pages')).toContainText('Review this paragraph.');
    });
    test('a stale comment keeps the draft and refuses overwrite', async ({ page }) => {
      await ownCard(page).getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      const field = page.getByTestId('review-edit-input');
      await field.fill('My draft');
      await page.evaluate(() => {
        const editor = window.__commentEdit;
        const item = editor
          .getReviewItems()
          .find((x) => x.kind === 'comment' && x.author === 'Demo Reviewer')!;
        editor.setCommentText(item.key, 'External edit.');
      });
      await expect(field).toHaveValue('My draft');
      await expect(
        page.getByText('This comment changed. Your draft is kept. Cancel to see the latest text.')
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect.poll(() => commentText(page)).toBe('External edit.');
    });
    test('reply and resolved thread edit retain their thread state', async ({ page }) => {
      await page.evaluate(() => {
        const e = window.__commentEdit;
        const item = e
          .getReviewItems()
          .find((x) => x.kind === 'comment' && x.author === 'Demo Reviewer')!;
        e.replyToReviewItem(item.key, 'Own reply.');
      });
      const reply = page.getByTestId('review-reply').first();
      await reply.getByTestId('review-comment-actions').click();
      await page.getByTestId('review-edit').click();
      await reply.getByTestId('review-edit-input').fill('Updated reply.');
      await reply.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(reply).toContainText('Updated reply.');
      await expect(page.getByTestId('review-reply')).toContainText('Updated reply.');
      await page.evaluate(() => {
        const e = window.__commentEdit;
        const item = e
          .getReviewItems()
          .find((x) => x.kind === 'comment' && x.text === 'Original comment.')!;
        e.setCommentResolved(item.key, true);
      });
      await page.locator('.docx-review__resolved-toggle').click();
      await page.getByRole('button', { name: 'Comment actions', exact: true }).first().click();
      await page.getByTestId('review-edit').click();
      await page.getByTestId('review-edit-input').fill('Resolved edit.');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      expect(
        await page.evaluate(
          () =>
            window.__commentEdit.getReviewItems().find((x) => x.text === 'Resolved edit.')?.resolved
        )
      ).toBe(true);
    });
  });
}
