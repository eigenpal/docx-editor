/**
 * Tracked non-text elements — an image inserted in suggesting mode is a
 * genuine tracked change: it paints with a revision outline, shows one sidebar
 * card, Reject removes the picture, Accept keeps it as a plain image.
 *
 * Generalizes the tracked-changes model from text to inline atom nodes
 * (image, shape, …). Background: "all elements should be tracked".
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import { ensureTrackedChangeCardExpanded } from '../helpers/tracked-changes';

// 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const REVISION_BAR_LEFT_OFFSET_PX = 10;

type ImageLayoutTarget =
  | 'inline'
  | 'squareLeft'
  | 'squareRight'
  | 'topAndBottom'
  | 'behind'
  | 'inFront';

async function setSuggestionMode(page: import('@playwright/test').Page, active: boolean) {
  const ok = await page.evaluate(
    (a) => window.__DOCX_EDITOR_E2E__?.setSuggestionMode(a, 'Jane') ?? false,
    active
  );
  await page.locator('.ProseMirror').first().focus();
  return ok;
}

async function insertImage(
  page: import('@playwright/test').Page,
  options: { width?: number; height?: number; layoutTarget?: ImageLayoutTarget } = {}
) {
  return page.evaluate(
    ({ src, width, height, layoutTarget }) =>
      window.__DOCX_EDITOR_E2E__?.insertImage?.(src, width, height, layoutTarget) ?? false,
    { src: PNG, width: options.width, height: options.height, layoutTarget: options.layoutTarget }
  );
}

async function selectFirstImage(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__?.selectFirstImage?.() ?? false);
}

async function rotateFirstImage(
  page: import('@playwright/test').Page,
  transform = 'rotate(90deg)'
) {
  return page.evaluate((nextTransform) => {
    const view = window.__DOCX_EDITOR_E2E__?.getView?.();
    if (!view) return false;
    let imagePos: number | null = null;
    let imageNode: { attrs: Record<string, unknown> } | null = null;
    view.state.doc.descendants(
      (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => {
        if (imagePos != null) return false;
        if (node.type.name === 'image') {
          imagePos = pos;
          imageNode = node;
          return false;
        }
        return true;
      }
    );
    if (imagePos == null || !imageNode) return false;
    view.dispatch(
      view.state.tr.setNodeMarkup(imagePos, undefined, {
        ...imageNode.attrs,
        transform: nextTransform,
      })
    );
    return true;
  }, transform);
}

async function expectChangeBarTracksImage(
  page: import('@playwright/test').Page,
  imageSelector: string,
  barSelector: string
) {
  const image = page.locator(imageSelector);
  const bar = page.locator(barSelector);
  const content = page.locator('.layout-page-content').first();

  await expect(image).toHaveCount(1);
  await expect(bar).toHaveCount(1);

  const imageBox = await image.boundingBox();
  const barBox = await bar.boundingBox();
  const contentBox = await content.boundingBox();
  expect(imageBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  expect(contentBox).not.toBeNull();

  expect(await bar.evaluate((element) => (element as HTMLElement).style.left)).toBe(
    `-${REVISION_BAR_LEFT_OFFSET_PX}px`
  );
  const renderedLeftOffset = (contentBox?.x ?? 0) - (barBox?.x ?? 0);
  expect(renderedLeftOffset).toBeGreaterThan(0);
  expect(renderedLeftOffset).toBeLessThanOrEqual(REVISION_BAR_LEFT_OFFSET_PX + 1);
  expect(Math.abs((barBox?.y ?? 0) - (imageBox?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (barBox?.y ?? 0) + (barBox?.height ?? 0) - ((imageBox?.y ?? 0) + (imageBox?.height ?? 0))
    )
  ).toBeLessThanOrEqual(1);
}

test.describe('Tracked image insertion', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('image inserted in suggesting mode paints as a tracked insertion', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    // The painted picture carries the revision dataset + green outline.
    const tracked = page.locator('img.docx-insertion[data-revision-id]');
    await expect(tracked).toHaveCount(1);
    await expect(tracked).toHaveCSS('outline-color', 'rgb(46, 125, 50)');
    await expectChangeBarTracksImage(
      page,
      'img.layout-run-image.docx-insertion[data-revision-id]',
      '.layout-page-content > .layout-revision-bars ' +
        '.layout-revision-change-bar.layout-revision-ins[data-revision-id]'
    );
  });

  test('rotated inline insertion keeps revision metadata on the wrapper and paints the child image', async ({
    page,
  }) => {
    await editor.typeText('before ');
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    expect(await rotateFirstImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const wrapper = page.locator('.layout-run-image-wrapper.docx-insertion[data-revision-id]');
    const image = wrapper.locator('img.layout-run-image');
    await expect(wrapper).toHaveCount(1);
    await expect(image).toHaveCount(1);
    await expect(wrapper).toHaveCSS('width', '60px');
    await expect(wrapper).toHaveCSS('height', '80px');
    await expect(image).toHaveCSS('outline-color', 'rgb(46, 125, 50)');
    await expect(image).not.toHaveAttribute('data-revision-id', /.+/);

    await expectChangeBarTracksImage(
      page,
      '.layout-run-image-wrapper.docx-insertion[data-revision-id]',
      '.layout-page-content > .layout-revision-bars .layout-revision-change-bar.layout-revision-ins[data-revision-id]'
    );
  });

  test('an inserted image gets a sidebar card anchored at the image', async ({ page }) => {
    // The card must anchor to the picture's Y, not a fallback position — the
    // sidebar anchor map has to register the revision id from the image atom,
    // not only from text nodes. Without it, an image-only change shows no card.
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    const card = page.locator('.docx-tracked-change-card');
    await expect(card).toHaveCount(1);

    const imgTop = await page
      .locator('img.docx-insertion')
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);
    const cardTop = await card.first().evaluate((el) => el.getBoundingClientRect().top);
    // Anchored next to the image (not at the unpositioned fallback ~top of doc).
    expect(Math.abs(cardTop - imgTop)).toBeLessThan(80);
  });

  test('Reject removes the inserted image and its card', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await ensureTrackedChangeCardExpanded(page);
    await page.locator('.docx-tracked-change-card button[title="Reject"]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('img.layout-run-image')).toHaveCount(0);
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(0);
  });

  test('Accept keeps the inserted image as a plain picture', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await ensureTrackedChangeCardExpanded(page);
    await page.locator('.docx-tracked-change-card button[title="Accept"]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('img.layout-run-image')).toHaveCount(1);
    await expect(page.locator('img.docx-insertion')).toHaveCount(0);
    expect(await page.locator('[data-revision-id]').count()).toBe(0);
  });

  test('deleting an existing image in suggesting mode strikes it through (tracked)', async ({
    page,
  }) => {
    // Insert a permanent picture in editing mode, then delete it while suggesting.
    expect(await setSuggestionMode(page, false)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(100);

    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await selectFirstImage(page)).toBe(true);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    // The picture stays but is marked as a tracked deletion (red outline),
    // not removed outright.
    const del = page.locator('img.docx-deletion[data-revision-id]');
    await expect(del).toHaveCount(1);
    await expect(del).toHaveCSS('outline-color', 'rgb(198, 40, 40)');
  });

  test('rotated inline deletion keeps red outline and deletion opacity on the child image', async ({
    page,
  }) => {
    await editor.typeText('before ');
    expect(await setSuggestionMode(page, false)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    expect(await rotateFirstImage(page)).toBe(true);
    await page.waitForTimeout(100);

    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await selectFirstImage(page)).toBe(true);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    const wrapper = page.locator('.layout-run-image-wrapper.docx-deletion[data-revision-id]');
    const image = wrapper.locator('img.layout-run-image');
    await expect(wrapper).toHaveCount(1);
    await expect(image).toHaveCount(1);
    await expect(wrapper).toHaveCSS('width', '60px');
    await expect(wrapper).toHaveCSS('height', '80px');
    await expect(image).toHaveCSS('outline-color', 'rgb(198, 40, 40)');
    await expect(image).toHaveCSS('opacity', '0.6');
    await expect(image).not.toHaveAttribute('data-revision-id', /.+/);

    await expectChangeBarTracksImage(
      page,
      '.layout-run-image-wrapper.docx-deletion[data-revision-id]',
      '.layout-page-content > .layout-revision-bars .layout-revision-change-bar.layout-revision-del[data-revision-id]'
    );
  });

  test('floating image insertion paints tracked cues and a matching margin bar', async ({
    page,
  }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(
      await insertImage(page, {
        width: 96,
        height: 64,
        layoutTarget: 'squareLeft',
      })
    ).toBe(true);
    await page.waitForTimeout(200);

    const image = page.locator('.layout-page-floating-image.docx-insertion[data-revision-id] img');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveCSS('outline-color', 'rgb(46, 125, 50)');

    await expectChangeBarTracksImage(
      page,
      '.layout-page-floating-image.docx-insertion[data-revision-id] img',
      '.layout-page-content > .layout-revision-bars .layout-revision-change-bar.layout-revision-ins[data-revision-id]'
    );
  });

  test('floating helper preserves the rendered inline position during promotion', async ({
    page,
  }) => {
    await editor.typeText('prefix before image ');
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(
      await insertImage(page, {
        width: 96,
        height: 64,
        layoutTarget: 'squareLeft',
      })
    ).toBe(true);
    await page.waitForTimeout(200);

    const offset = await page
      .locator('.layout-page-floating-image.docx-insertion')
      .evaluate((element) => {
        const imageBox = element.getBoundingClientRect();
        const contentBox = element.closest('.layout-page-content')?.getBoundingClientRect();
        return contentBox ? imageBox.left - contentBox.left : 0;
      });
    expect(offset).toBeGreaterThan(40);
  });

  test('floating image deletion keeps geometry while painting deletion cues and a margin bar', async ({
    page,
  }) => {
    expect(
      await insertImage(page, {
        width: 112,
        height: 74,
        layoutTarget: 'squareLeft',
      })
    ).toBe(true);
    await page.waitForTimeout(200);

    const before = await page.locator('.layout-page-floating-image img').first().boundingBox();
    expect(before).not.toBeNull();

    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await selectFirstImage(page)).toBe(true);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    const image = page.locator('.layout-page-floating-image.docx-deletion[data-revision-id] img');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveCSS('outline-color', 'rgb(198, 40, 40)');

    const after = await image.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);

    await expectChangeBarTracksImage(
      page,
      '.layout-page-floating-image.docx-deletion[data-revision-id] img',
      '.layout-page-content > .layout-revision-bars .layout-revision-change-bar.layout-revision-del[data-revision-id]'
    );
  });
});
