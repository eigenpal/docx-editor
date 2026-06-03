/**
 * Vue regression for #670 — the image selection overlay must track the inline
 * image when its position changes, and must never strand at the image's old
 * spot once the image is pushed onto another page.
 *
 * Before the fix the overlay anchored to a stale ProseMirror position resolved
 * with an unscoped `querySelectorAll('[data-doc-from]')`, so inserting
 * paragraphs above the image left the blue frame behind on the previous page.
 * The fix re-derives the selection from the live PM state through the
 * body-scoped `findBodyPmAnchor` and accounts for scroll offset.
 */
import { test, expect, type Page } from '@playwright/test';

const FIXTURE = 'e2e/fixtures/image-layout-modes-demo.docx';
const INLINE_IMAGE = '.layout-line .layout-run-image';
const OVERLAY = '.image-overlay';

async function loadFixture(page: Page) {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.locator('input[type="file"][accept=".docx"]').first().setInputFiles(FIXTURE);
  await page.waitForSelector('[data-page-number]');
  await page.locator(INLINE_IMAGE).first().waitFor();
}

/** True when the overlay is painted but does not overlap the image — i.e. stranded. */
async function overlayStranded(page: Page) {
  return page.evaluate(
    ({ overlaySel, imgSel }) => {
      const ov = document.querySelector(overlaySel) as HTMLElement | null;
      if (!ov) return false; // overlay correctly cleared — not stranded
      const img = document.querySelector(imgSel) as HTMLElement | null;
      if (!img) return true;
      const o = ov.getBoundingClientRect();
      const i = img.getBoundingClientRect();
      const overlaps = !(
        o.right < i.left ||
        o.left > i.right ||
        o.bottom < i.top ||
        o.top > i.bottom
      );
      return !overlaps;
    },
    { overlaySel: OVERLAY, imgSel: INLINE_IMAGE }
  );
}

test('Vue: image overlay never strands when the image is pushed to a new page (#670)', async ({
  page,
}) => {
  await loadFixture(page);

  const image = page.locator(INLINE_IMAGE).first();

  // Select the inline image — the overlay appears wrapped around it.
  await image.click();
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await overlayStranded(page)).toBe(false);

  // Passive scroll (no re-click) must keep the frame glued to the image: the
  // overlay is absolute inside the scroll container, so its position needs the
  // scroll offset and a scroll listener on the right element.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await overlayStranded(page)).toBe(false);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(200);
  expect(await overlayStranded(page)).toBe(false);

  const topBefore = (await image.boundingBox())!.y;

  // Place the caret just before the image and push it down with Enter until it
  // moves well past its original spot (the exact #670 reproduction).
  await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // The repro must actually move the image, otherwise the assertion is hollow.
  const topAfter = (await image.boundingBox())!.y;
  expect(topAfter).toBeGreaterThan(topBefore + 100);

  // The frame must not be left behind floating over empty space.
  expect(await overlayStranded(page)).toBe(false);

  // Re-selecting at the new (scrolled) location resolves the image through the
  // body-scoped anchor and the overlay wraps it again — proving the frame
  // follows rather than latches onto a stale position.
  await image.scrollIntoViewIfNeeded();
  await image.click();
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await overlayStranded(page)).toBe(false);
});
