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

/** Largest gap between any overlay box edge and the matching image edge. */
async function maxEdgeOffset(page: Page) {
  return page.evaluate(
    ({ overlaySel, imgSel }) => {
      const ov = document.querySelector(overlaySel) as HTMLElement | null;
      const img = document.querySelector(imgSel) as HTMLElement | null;
      if (!ov || !img) return Infinity;
      const o = ov.getBoundingClientRect();
      const i = img.getBoundingClientRect();
      return Math.max(
        Math.abs(o.left - i.left),
        Math.abs(o.top - i.top),
        Math.abs(o.right - i.right),
        Math.abs(o.bottom - i.bottom)
      );
    },
    { overlaySel: OVERLAY, imgSel: INLINE_IMAGE }
  );
}

test('Vue: selection frame stays wrapped on the image across zoom changes (#764)', async ({
  page,
}) => {
  await loadFixture(page);

  const image = page.locator(INLINE_IMAGE).first();
  await image.click();
  await expect(page.locator(OVERLAY)).toBeVisible();

  // At 100% the frame wraps the image tightly.
  expect(await maxEdgeOffset(page)).toBeLessThan(3);

  // Zooming scales the page via a transform on the unscaled scroll viewport the
  // overlay lives in, so the overlay's measured rect shifts and must be
  // recomputed. Before #764 the overlay cached its rect at the old zoom and
  // reconstructed the painted position as `left * zoom`; if the recompute
  // didn't land at the new zoom, the stale rect got amplified and the frame
  // jumped sideways off the image. The re-anchor must not depend on the
  // animation-frame settle loop alone — that loop is paused while the tab is
  // backgrounded, and on a real page it can latch onto the pre-transition rect.
  //
  // Pin that down deterministically by disabling `requestAnimationFrame` for
  // the duration of the zoom: the only thing that can re-anchor the frame is
  // the timer-based safety net, which the fix added. (CSS transforms and
  // `getBoundingClientRect` don't need rAF, so the image itself still moves.)
  await page.evaluate(() => {
    const w = window as unknown as { __raf?: typeof window.requestAnimationFrame };
    w.__raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
  });

  const zoomIn = page.locator('.zoom-group button[title="Zoom in"]');
  for (let i = 0; i < 3; i++) await zoomIn.click();
  await page.waitForTimeout(1000); // let the transform settle + the safety-net timer fire
  expect(await maxEdgeOffset(page)).toBeLessThan(3);

  // Zooming back out must keep it aligned too (round-trip — the stale-rect bug
  // could even leave the frame offset once returned to 100%).
  const zoomOut = page.locator('.zoom-group button[title="Zoom out"]');
  for (let i = 0; i < 4; i++) await zoomOut.click();
  await page.waitForTimeout(1000);
  expect(await maxEdgeOffset(page)).toBeLessThan(3);

  await page.evaluate(() => {
    const w = window as unknown as { __raf?: typeof window.requestAnimationFrame };
    if (w.__raf) window.requestAnimationFrame = w.__raf;
  });
});

test('Vue: selection frame re-anchors when the page re-centers after selection (#764)', async ({
  page,
}) => {
  await loadFixture(page);

  const image = page.locator(INLINE_IMAGE).first();
  await image.click();
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await maxEdgeOffset(page)).toBeLessThan(3);

  // The real #764 race: `.docx-editor-vue__pages` re-centers horizontally as the
  // layout settles just after load (a `translateX` change — no ResizeObserver
  // would see it), shifting the image out from under a frame measured one frame
  // too early. Reproduce it deterministically by shifting the pages container
  // right after selection — within the post-selection re-anchor window. A single
  // updatePosition leaves the frame stranded at the old spot; the settle loop
  // must follow the image to its new position.
  await page.evaluate(() => {
    const p = document.querySelector('.docx-editor-vue__pages') as HTMLElement;
    p.style.transform = `${p.style.transform} translateX(60px)`;
  });
  await page.waitForTimeout(600); // settle window + buffer
  expect(await maxEdgeOffset(page)).toBeLessThan(3);
});

test('Vue: selection frame re-anchors when comments shift the page long after selection (#764)', async ({
  page,
}) => {
  await loadFixture(page);

  const image = page.locator(INLINE_IMAGE).first();
  await image.click();
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await maxEdgeOffset(page)).toBeLessThan(3);

  // Let the post-selection re-anchor loop fully finish, so only a transform
  // observer — not the initial settle window — can catch the next shift.
  await page.waitForTimeout(900);

  // Opening the comments sidebar slides `.docx-editor-vue__pages` sideways
  // (a translateX) — and that can happen seconds after the image was selected,
  // e.g. while moving between comments. It moves the image out from under the
  // frame with no scroll / resize / zoom event, so without observing the pages
  // transform the frame strands ~translateX px off the image. React's overlay
  // lives inside that container and never drifts.
  await page.evaluate(() => {
    const p = document.querySelector('.docx-editor-vue__pages') as HTMLElement;
    p.style.transform = `${p.style.transform} translateX(-120px)`;
  });
  await page.waitForTimeout(700); // observer re-anchor + transform transition
  expect(await maxEdgeOffset(page)).toBeLessThan(3);
});

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
