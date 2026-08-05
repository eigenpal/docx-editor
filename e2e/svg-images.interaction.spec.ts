// Embedded SVG paints as an image, not as an "unsupported format" placeholder.
//
// `border-overlay-layout-demo.docx` carries two anchored decorative drawings whose media
// parts are raw SVG with no raster fallback, which is the shape a placeholder regression
// would silently swallow.

import { expect, test } from '@playwright/test';

const DEMO_URL = 'http://localhost:5273/?fixture=border-overlay-layout-demo.docx';

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.docx-page', { timeout: 30_000 });
});

test('embedded SVG drawings render at the authored extent', async ({ page }) => {
  const images = page.locator('.docx-drawing-ready img.docx-drawing-image');
  await expect(images).toHaveCount(2);

  // No placeholder card anywhere — a refused SVG would paint one carrying its reason.
  await expect(page.locator('.docx-drawing-placeholder')).toHaveCount(0);

  const painted = await images.evaluateAll((nodes) =>
    nodes.map((node) => {
      const image = node as HTMLImageElement;
      const rect = image.getBoundingClientRect();
      return {
        scheme: (image.getAttribute('src') ?? '').split(':')[0],
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })
  );

  for (const image of painted) {
    // Bytes reach the DOM only through a host-minted object URL.
    expect(image.scheme).toBe('blob');
    // A decoded SVG reports its root width/height as the natural size.
    expect(image.complete).toBe(true);
    expect(image.naturalWidth).toBe(180);
    expect(image.naturalHeight).toBe(180);
    // Layout comes from wp:extent, so the painted box is not the intrinsic size.
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect(image.width).toBeLessThan(180);
  }
});

test('a script inside an SVG cannot run through the paint path', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">',
      '<script>window.__svgScriptRan = true;<',
      '/script>',
      '<rect width="40" height="40" fill="red"/>',
      '</svg>',
    ].join('');
    const url = URL.createObjectURL(new Blob([hostile], { type: 'image/svg+xml' }));
    const probe = document.createElement('img');
    probe.src = url;
    document.body.append(probe);
    await new Promise<void>((resolve) => {
      probe.onload = () => resolve();
      probe.onerror = () => resolve();
      setTimeout(resolve, 2000);
    });
    const rendered = probe.complete && probe.naturalWidth > 0;
    probe.remove();
    URL.revokeObjectURL(url);
    return { rendered, scriptRan: '__svgScriptRan' in window };
  });

  // The same blob-URL-into-<img> path the painter uses: renders, but in secure static mode.
  expect(result.rendered).toBe(true);
  expect(result.scriptRan).toBe(false);
});
