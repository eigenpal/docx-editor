import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import { findPageContaining } from '../helpers/find-page';

const FIXTURE = 'fixtures/comprehensive-word-element-test.docx';

/** Tab-stop positions are authored in twips; the painter works at 96dpi. */
const twToPx = (tw: number) => tw / 15;

/**
 * Regressions reported against the 25-page "Comprehensive Word Element Test"
 * torture document (5 sections, 4 header/footer pairs):
 *
 * 1. Custom tab stops were ignored when the default 720-twip grid offered a
 *    nearer stop — header "title<tab>CONFIDENTIAL" and footer
 *    "dept<tab>Page N of M" collapsed instead of right-aligning at the margin,
 *    and section 11.1's right/center stops landed on the grid.
 * 2. Boxed callout paragraphs (section 13) painted their borders into the
 *    spacing gap and visually touched.
 * 3. The `w:tblpPr` floating table (section 16) ignored `tblpXSpec="center"`
 *    and pinned `vertAnchor="text"` offsets to the page top.
 */

async function loadTortureDoc(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('.layout-page-header .layout-line');
  return editor;
}

test.describe('comprehensive torture doc regressions', () => {
  test('header and footer right tabs reach the margin stop with field spaces intact', async ({
    page,
  }) => {
    await loadTortureDoc(page);

    // Page 2 carries the default section header/footer pair.
    const page2 = page.locator('.layout-page').nth(1);
    await page2.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    const geom = await page2.evaluate((pg) => {
      const content = pg.querySelector('.layout-page-content')!.getBoundingClientRect();
      const header = pg.querySelector('.layout-page-header')!;
      const conf = [...header.querySelectorAll('.layout-run-text')].find((r) =>
        r.textContent?.includes('CONFIDENTIAL')
      );
      const footer = pg.querySelector('.layout-page-footer')!;
      const footerLine = footer.querySelector('.layout-line');
      return {
        confidentialRight: conf ? conf.getBoundingClientRect().right - content.left : null,
        footerText: footerLine?.textContent ?? '',
        footerLastRight: footerLine?.lastElementChild
          ? footerLine.lastElementChild.getBoundingClientRect().right - content.left
          : null,
        contentWidth: content.width,
      };
    });

    // The right stop is at 9026 twips ≈ 601.7px in a 624px content box. Before
    // the fix the tab collapsed to the next 48px grid stop (~280px).
    expect(geom.confidentialRight).not.toBeNull();
    expect(geom.confidentialRight!).toBeGreaterThan(560);
    expect(geom.confidentialRight!).toBeLessThanOrEqual(geom.contentWidth + 1);

    // Footer: PAGE/NUMPAGES fields keep their authored surrounding spaces
    // (the flex right-anchor used to collapse "Page 2 of 25" to "Page2of25"),
    // and the page number block right-aligns at the stop.
    expect(geom.footerText).toMatch(/Page \d+ of \d+/);
    expect(geom.footerLastRight!).toBeGreaterThan(560);
  });

  test('section 11.1 honors right and center tab stops', async ({ page }) => {
    await loadTortureDoc(page);
    const target = await findPageContaining(page, '11.1 Tab Stops');

    const geom = await target.evaluate((pg) => {
      const content = pg.querySelector('.layout-page-content')!.getBoundingClientRect();
      const lines = [...pg.querySelectorAll('.layout-line')];
      const right = lines.find((l) => l.textContent?.includes('Right-aligned content'));
      const center = lines.find((l) => l.textContent?.includes('Centered at midpoint'));
      const rightRun = right
        ? [...right.querySelectorAll('.layout-run-text')].find((r) =>
            r.textContent?.includes('Right-aligned content')
          )
        : null;
      const centerRun = center
        ? [...center.querySelectorAll('.layout-run-text')].find((r) =>
            r.textContent?.includes('Centered at midpoint')
          )
        : null;
      const rect = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);
      return {
        contentWidth: content.width,
        rightEdge: rect(rightRun) ? rect(rightRun)!.right - content.left : null,
        centerMid: rect(centerRun)
          ? (rect(centerRun)!.left + rect(centerRun)!.right) / 2 - content.left
          : null,
      };
    });

    // Right stop at 9026tw ≈ 601.7px; center stop at 4680tw ≈ 312px.
    expect(geom.rightEdge).not.toBeNull();
    expect(Math.abs(geom.rightEdge! - twToPx(9026))).toBeLessThan(6);
    expect(geom.centerMid).not.toBeNull();
    expect(Math.abs(geom.centerMid! - twToPx(4680))).toBeLessThan(6);
  });

  test('section 13 boxed callouts keep their spacing gaps', async ({ page }) => {
    await loadTortureDoc(page);
    const target = await findPageContaining(page, '13. Borders, Shading & Callouts');

    const gaps = await target.evaluate((pg) => {
      const labels = ['INFO:', 'WARNING:', 'SUCCESS:', 'ERROR:'];
      const boxes = labels
        .map((label) =>
          [...pg.querySelectorAll('.layout-paragraph')].find((p) =>
            p.textContent?.startsWith(label)
          )
        )
        .filter(Boolean)
        .map((p) => p!.querySelector('.layout-paragraph-border')!.getBoundingClientRect());
      const out: number[] = [];
      for (let i = 1; i < boxes.length; i++) out.push(boxes[i].top - boxes[i - 1].bottom);
      return out;
    });

    // w:after=200tw ≈ 13.3px between the border boxes (each paragraph's border
    // extent is flow height, not an overlay into the gap). Before the fix the
    // boxes touched (gap ≈ 0, often fractionally negative).
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(8);
      expect(gap).toBeLessThan(20);
    }
  });

  test('section 16 floating table centers below its anchor paragraph', async ({ page }) => {
    await loadTortureDoc(page);
    const target = await findPageContaining(page, '16. Floating Table');

    const geom = await target.evaluate((pg) => {
      const content = pg.querySelector('.layout-page-content')!.getBoundingClientRect();
      const table = pg.querySelector('.layout-table')?.getBoundingClientRect() ?? null;
      const intro = [...pg.querySelectorAll('.layout-paragraph')].find((p) =>
        p.textContent?.includes('Below is a floating table')
      );
      return {
        contentWidth: content.width,
        tableCenter: table ? (table.left + table.right) / 2 - content.left : null,
        tableTop: table ? table.top - content.top : null,
        introBottom: intro ? intro.getBoundingClientRect().bottom - content.top : null,
        introText: intro?.textContent ?? '',
      };
    });

    // tblpXSpec="center": centered in the 624px content box (was left-pinned).
    expect(geom.tableCenter).not.toBeNull();
    expect(Math.abs(geom.tableCenter! - geom.contentWidth / 2)).toBeLessThan(4);

    // vertAnchor="text" + tblpY=200tw: below the intro paragraph, not at the
    // page top beside the heading.
    expect(geom.introBottom).not.toBeNull();
    expect(geom.tableTop!).toBeGreaterThan(geom.introBottom! - 1);

    // The intro paragraph is no longer squeezed/truncated by a bogus wrap zone.
    expect(geom.introText).toContain('callout tables.');
  });
});
