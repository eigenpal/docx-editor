import { expect, test } from '@playwright/test';
import {
  PUBLIC_RENDER_API_MODULE,
  renderFixtureThroughPublicApi,
} from '../helpers/public-render-api';

test.describe('public rendering facade', () => {
  test('renders real OOXML pages and selection geometry', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'demo.docx');

    const result = await page.evaluate(async (apiModule) => {
      const api = (await import(apiModule)) as {
        caretAt(document: unknown, position: number): { height: number } | null;
        rectsFor(document: unknown, from: number, to: number): readonly unknown[];
      };
      const root = document.querySelector<HTMLElement>('#public-render-api-root');
      if (!root) throw new Error('public rendering root missing');
      const rendered = (
        window as unknown as {
          __publicRenderedDocument: {
            pages: readonly { boxes: readonly { docFrom?: number; docTo?: number }[] }[];
          };
        }
      ).__publicRenderedDocument;
      const anchor = rendered.pages
        .flatMap((renderedPage) => renderedPage.boxes)
        .find((box) => box.docFrom !== undefined && box.docTo !== undefined);
      if (anchor?.docFrom === undefined || anchor.docTo === undefined) {
        throw new Error('painted position anchor missing');
      }
      const caret = api.caretAt(rendered, anchor.docFrom);
      const rects =
        anchor.docTo > anchor.docFrom ? api.rectsFor(rendered, anchor.docFrom, anchor.docTo) : [];
      return {
        pageCount: rendered.pages.length,
        boxCount: rendered.pages.reduce((sum, renderedPage) => sum + renderedPage.boxes.length, 0),
        caretHeight: caret?.height ?? 0,
        selectionBoxCount: rects.length,
      };
    }, PUBLIC_RENDER_API_MODULE);

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.boxCount).toBeGreaterThan(0);
    expect(result.caretHeight).toBeGreaterThan(0);
    expect(result.selectionBoxCount).toBeGreaterThan(0);
  });

  test('paints DOCX superscript and subscript without changing line boxes', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'demo.docx');

    const scripts = await page.evaluate(() => {
      const runs = [...document.querySelectorAll<HTMLElement>('.layout-run-text')];
      const read = (top: string) => {
        const run = runs.find((element) => element.style.top === top);
        const line = run?.closest<HTMLElement>('.layout-line');
        return run && line
          ? {
              position: run.style.position,
              fontSize: run.style.fontSize,
              verticalAlign: run.style.verticalAlign,
              lineHeight: line.getBoundingClientRect().height,
            }
          : null;
      };
      return {
        superscript: read('-0.4em'),
        subscript: read('0.2em'),
      };
    });

    expect(scripts.superscript).toEqual({
      position: 'relative',
      fontSize: '0.75em',
      verticalAlign: '',
      lineHeight: expect.any(Number),
    });
    expect(scripts.subscript).toEqual({
      position: 'relative',
      fontSize: '0.75em',
      verticalAlign: '',
      lineHeight: expect.any(Number),
    });
    expect(scripts.superscript!.lineHeight).toBeGreaterThan(0);
    expect(scripts.subscript!.lineHeight).toBeGreaterThan(0);
  });

  test('keeps dense footnotes inside their painted pages', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'footnote-bottom-overflow.docx');

    const footnotes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.layout-footnote-area')].map((area) => {
        const pageElement = area.closest<HTMLElement>('.layout-page');
        const areaRect = area.getBoundingClientRect();
        const pageRect = pageElement?.getBoundingClientRect();
        return {
          text: area.textContent?.trim() ?? '',
          bottom: areaRect.bottom,
          pageBottom: pageRect?.bottom ?? 0,
        };
      })
    );

    expect(footnotes.length).toBeGreaterThan(0);
    expect(footnotes.every((footnote) => footnote.text.length > 0)).toBe(true);
    expect(footnotes.every((footnote) => footnote.bottom <= footnote.pageBottom + 1)).toBe(true);
  });

  test('paints a document watermark behind body content', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'watermark-confidential.docx');

    const watermark = page.locator('.layout-watermark-layer').first();
    await expect(watermark).toBeVisible();
    await expect(watermark).toContainText('CONFIDENTIAL');
    expect(await watermark.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
      'none'
    );
  });

  test('positions wrap-none images without consuming the text line', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'wrap-none-positioned-image-demo.docx');

    const geometry = await page.evaluate(() => {
      const image = document.querySelector<HTMLElement>('.layout-page-floating-image');
      const paragraph = [...document.querySelectorAll<HTMLElement>('.layout-paragraph')].find(
        (element) => element.textContent?.trim()
      );
      const line = paragraph?.querySelector<HTMLElement>('.layout-line');
      if (!image || !paragraph || !line) return null;
      return {
        imagePosition: getComputedStyle(image).position,
        imageWidth: image.getBoundingClientRect().width,
        lineHeight: line.getBoundingClientRect().height,
        text: paragraph.textContent?.trim() ?? '',
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.imagePosition).toBe('absolute');
    expect(geometry!.imageWidth).toBeGreaterThan(0);
    expect(geometry!.lineHeight).toBeGreaterThan(0);
    expect(geometry!.text.length).toBeGreaterThan(0);
  });

  test('paints resolved DOCX list markers beside their text', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'docx-editor-numbering.docx');

    const markers = await page.locator('.layout-list-marker').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? '',
          width: rect.width,
          height: rect.height,
        };
      })
    );

    expect(markers.length).toBeGreaterThan(1);
    expect(markers.every((marker) => marker.text.length > 0)).toBe(true);
    expect(markers.every((marker) => marker.width > 0 && marker.height > 0)).toBe(true);
  });

  test('paints header tables and paragraphs in the page header band', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'header-with-table-and-paragraphs.docx');

    const header = page.locator('.layout-page-header').first();
    await expect(header).toBeVisible();
    await expect(header.locator('.layout-table')).toHaveCount(1);
    expect((await header.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test('keeps issue #472 anchored text box in painted flow', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'issue-472-floating-textbox.docx');
    const geometry = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('.layout-textbox');
      const paragraph = [...document.querySelectorAll<HTMLElement>('.layout-paragraph')].find(
        (el) => el.textContent?.includes('Northwind Sample Works')
      );
      if (!box || !paragraph) return null;
      const boxRect = box.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      return {
        boxTop: boxRect.top,
        boxBottom: boxRect.bottom,
        paragraphTop: paragraphRect.top,
        paragraphBottom: paragraphRect.bottom,
        splitLines: paragraph.querySelectorAll('.layout-line-segment').length,
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.boxTop).toBeGreaterThan(geometry!.paragraphTop);
    expect(geometry!.boxBottom).toBeLessThan(geometry!.paragraphBottom);
    expect(geometry!.splitLines).toBeGreaterThan(1);
  });

  test('keeps issue #734 RTL table visual order', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'rtl-table-bidivisual.docx');
    const positions = await page.evaluate(() => {
      const cells = [
        ...document.querySelectorAll<HTMLElement>('.layout-page-content .layout-table-cell'),
      ].filter((cell) => !cell.dataset.vmergeContinuation);
      const label = cells.find((cell) => cell.textContent?.includes('בדיקה'));
      const field = cells.find((cell) => !cell.textContent?.includes('בדיקה'));
      if (!label || !field) return null;
      return {
        labelX: label.getBoundingClientRect().left,
        fieldX: field.getBoundingClientRect().left,
      };
    });
    expect(positions).not.toBeNull();
    expect(positions!.labelX).toBeGreaterThan(positions!.fieldX);
  });

  test('paginates table fragments without losing repeated headers', async ({ page }) => {
    await renderFixtureThroughPublicApi(page, 'repeated-table-header.docx');
    const tablePages = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.layout-page')]
        .map((pageElement) => {
          const table = pageElement.querySelector<HTMLElement>('.layout-table');
          const firstRow = table?.querySelector<HTMLElement>('.layout-table-row');
          return table && firstRow
            ? {
                page: pageElement.dataset.pageNumber,
                header: firstRow.textContent?.trim() ?? '',
                bottom: table.getBoundingClientRect().bottom,
                contentBottom:
                  pageElement
                    .querySelector<HTMLElement>('.layout-page-content')
                    ?.getBoundingClientRect().bottom ?? 0,
              }
            : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    );
    expect(tablePages.length).toBeGreaterThan(1);
    expect(
      Math.max(...tablePages.map((entry) => entry.bottom - entry.contentBottom))
    ).toBeLessThanOrEqual(4);
    expect(tablePages.slice(1).every((entry) => entry.header === tablePages[0].header)).toBe(true);
  });
});
