import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PUBLIC_RENDER_API_MODULE = `/@fs/${resolve('packages/core/dist/api.mjs')}`;

test('body content fills both section columns before continuing on the next page', async ({
  page,
}) => {
  await page.goto('/');

  const pages = await page.evaluate(async (apiModule) => {
    const { renderDocument } = (await import(apiModule)) as {
      renderDocument(document: unknown, root: HTMLElement): unknown;
    };
    const sectionProperties = {
      pageWidth: 7200,
      pageHeight: 5760,
      marginTop: 720,
      marginRight: 720,
      marginBottom: 720,
      marginLeft: 720,
      columnCount: 2,
      columnSpace: 360,
      equalWidth: true,
    };
    const paragraphs = Array.from({ length: 36 }, (_, index) => ({
      type: 'paragraph',
      content: [
        {
          type: 'run',
          content: [
            {
              type: 'text',
              text: `Body column paragraph ${String(index + 1).padStart(2, '0')}`,
            },
          ],
        },
      ],
    }));
    const document = {
      package: {
        document: {
          content: paragraphs,
          sections: [{ properties: sectionProperties, content: paragraphs }],
          finalSectionProperties: sectionProperties,
        },
      },
    };
    const root = window.document.createElement('div');
    window.document.body.replaceChildren(root);
    renderDocument(document, root);

    return Array.from(root.querySelectorAll<HTMLElement>('.layout-page')).map((pageElement) => {
      const pageRect = pageElement.getBoundingClientRect();
      const fragments = Array.from(
        pageElement.querySelectorAll<HTMLElement>('.layout-page-content > [data-block-id]')
      )
        .map((element) => {
          const match = element.textContent?.match(/Body column paragraph (\d+)/);
          if (!match) return null;
          return {
            paragraph: Number(match[1]),
            left: Math.round(element.getBoundingClientRect().left - pageRect.left),
          };
        })
        .filter((fragment): fragment is { paragraph: number; left: number } => fragment !== null);
      return { fragments };
    });
  }, PUBLIC_RENDER_API_MODULE);

  expect(pages.length).toBeGreaterThanOrEqual(2);
  const firstPage = pages[0].fragments;
  const firstPageLefts = [...new Set(firstPage.map((fragment) => fragment.left))].sort(
    (a, b) => a - b
  );
  expect(firstPageLefts).toHaveLength(2);
  expect(firstPageLefts[1] - firstPageLefts[0]).toBeGreaterThan(150);

  const firstColumn = firstPage.filter((fragment) => fragment.left === firstPageLefts[0]);
  const secondColumn = firstPage.filter((fragment) => fragment.left === firstPageLefts[1]);
  expect(firstColumn.length).toBeGreaterThan(0);
  expect(secondColumn.length).toBeGreaterThan(0);
  expect(Math.max(...firstColumn.map((fragment) => fragment.paragraph))).toBeLessThan(
    Math.min(...secondColumn.map((fragment) => fragment.paragraph))
  );
  expect(Math.max(...firstPage.map((fragment) => fragment.paragraph))).toBeLessThan(
    Math.min(...pages[1].fragments.map((fragment) => fragment.paragraph))
  );
});
