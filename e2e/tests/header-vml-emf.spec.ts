import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * First-page header with a VML→EMF letterhead image.
 *
 * The fixture's first-page header (`w:titlePg` + `headerReference type="first"`)
 * carries a logo as `<w:object><v:shape><v:imagedata r:id="rId1"/>` where
 * rId1 → `media/image1.emf`. Browsers can't decode EMF, so the parser extracts
 * the embedded PNG and uses it as the display URL. This spec guards:
 *   - the logo renders (non-broken `<img>` ≥50px tall) inside `.layout-page-header`
 *   - body text starts BELOW the header band (no overlap — #735/#740/#856)
 *   - clicking body text places the caret in the body (header doesn't block — #265)
 *   - the same header renders under `externalContent` mode
 *
 * Fixture regenerated with `node scripts/gen-fixture-header-vml-emf.mjs`.
 */
const FIXTURE = 'fixtures/header-vml-emf.docx';

test.describe('first-page header with VML/EMF image', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(FIXTURE);
    await page.waitForSelector('[data-page-number="1"] .layout-page-header img');
    await page.waitForTimeout(1200);
  });

  test('logo renders as a decoded image inside the page-1 header', async ({ page }) => {
    const img = page.locator('[data-page-number="1"] .layout-page-header img').first();
    const info = await img.evaluate((el: HTMLImageElement) => ({
      mime: el.src.slice(5, el.src.indexOf(';')),
      naturalW: el.naturalWidth,
      naturalH: el.naturalHeight,
      h: el.getBoundingClientRect().height,
    }));
    // EMF was rewritten to a browser-renderable raster.
    expect(['image/png', 'image/jpeg']).toContain(info.mime);
    // The image actually decoded (naturalWidth/Height === 0 means broken src).
    expect(info.naturalW).toBeGreaterThan(0);
    expect(info.naturalH).toBeGreaterThan(0);
    expect(info.h).toBeGreaterThanOrEqual(50);

    // smartTag-wrapped run survives.
    const headerText = await page
      .locator('[data-page-number="1"] .layout-page-header')
      .textContent();
    expect(headerText).toContain('SMARTTAG-CITY');
  });

  test('body text starts below the header band (no overlap)', async ({ page }) => {
    const { headerBottom, bodyTop, firstParaTop } = await page.evaluate(() => {
      const p1 = document.querySelector('[data-page-number="1"]')!;
      const header = p1.querySelector('.layout-page-header') as HTMLElement;
      const body = p1.querySelector('.layout-page-content') as HTMLElement;
      const hr = header.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      const firstPara = body.querySelector('.layout-paragraph');
      return {
        headerBottom: hr.bottom,
        bodyTop: br.top,
        firstParaTop: firstPara ? firstPara.getBoundingClientRect().top : -1,
      };
    });
    expect(bodyTop).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(firstParaTop).toBeGreaterThanOrEqual(headerBottom - 1);
  });

  test('clicking body text below the header places the caret in the body', async ({ page }) => {
    const para = page
      .locator('[data-page-number="1"] .layout-page-content .layout-paragraph')
      .filter({ hasText: 'Body line one' })
      .first();
    const box = await para.boundingBox();
    if (!box) throw new Error('body paragraph not found');
    await page.mouse.click(box.x + 30, box.y + box.height / 2);

    const sel = await page.evaluate(() => {
      const view = window.__DOCX_EDITOR_E2E__?.getView();
      return { from: view?.state.selection.from ?? -1, docSize: view?.state.doc.content.size ?? 0 };
    });
    expect(sel.from).toBeGreaterThan(0);
    expect(sel.from).toBeLessThan(sel.docSize);
  });
});

test('header renders from document.package.headers under externalContent mode', async ({
  page,
}) => {
  // ?externalContent=1 makes the playground parse the file itself and mount
  // <DocxEditor document={parsed} externalContent />, mimicking a host where
  // the body PM is populated by ySyncPlugin while headers/styles come from
  // the parsed `document` shell.
  await page.goto('/?e2e=1&empty=1&externalContent=1');
  await page.waitForSelector('[data-testid="docx-editor"]');
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('[data-page-number="1"] .layout-page-header img', { timeout: 15000 });

  const img = page.locator('[data-page-number="1"] .layout-page-header img').first();
  const naturalW = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(naturalW).toBeGreaterThan(0);
});
