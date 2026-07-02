import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PUBLIC_RENDER_API_MODULE = `/@fs/${resolve('packages/core/dist/api.mjs')}`;

test('paints each section header, distance, and relationship id on its pages', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (apiModule) => {
    const { renderDocument } = (await import(apiModule)) as {
      renderDocument(document: unknown, root: HTMLElement): unknown;
    };
    const paragraph = (text: string, sectionProperties?: Record<string, unknown>) => ({
      type: 'paragraph',
      ...(sectionProperties ? { sectionProperties } : {}),
      content: [{ type: 'run', content: [{ type: 'text', text }] }],
    });
    const header = (text: string) => ({
      type: 'header',
      hdrFtrType: 'default',
      content: [paragraph(text)],
    });
    const firstSection = {
      sectionStart: 'nextPage',
      headerDistance: 0,
      headerReferences: [{ type: 'default', rId: 'rId-header-one' }],
    };
    const secondSection = {
      headerDistance: 720,
      headerReferences: [{ type: 'default', rId: 'rId-header-two' }],
      pageBorders: {
        display: 'notFirstPage',
        top: { style: 'single', size: 8, color: '000000' },
      },
    };
    const firstParagraph = paragraph('First section body', firstSection);
    const secondParagraph = paragraph('Second section body');
    const document = {
      package: {
        document: {
          content: [firstParagraph, secondParagraph],
          sections: [
            { properties: firstSection, content: [firstParagraph] },
            { properties: secondSection, content: [secondParagraph] },
          ],
          finalSectionProperties: secondSection,
        },
        headers: new Map([
          ['rId-header-one', header('First section header')],
          ['rId-header-two', header('Second section header')],
        ]),
      },
    };
    const root = documentRoot();
    renderDocument(document, root);

    return [...root.querySelectorAll<HTMLElement>('.layout-page')].map((pageElement) => {
      const headerElement = pageElement.querySelector<HTMLElement>('.layout-page-header');
      const pageRect = pageElement.getBoundingClientRect();
      const headerRect = headerElement?.getBoundingClientRect();
      return {
        sectionIndex: pageElement.dataset.sectionIndex,
        sectionPageNumber: pageElement.dataset.sectionPageNumber,
        headerRId: headerElement?.dataset.hfRId,
        headerText: headerElement?.textContent ?? '',
        headerTop: headerRect ? headerRect.top - pageRect.top : -1,
        hasPageBorder: pageElement.querySelector('.layout-page-border') !== null,
      };
    });

    function documentRoot(): HTMLElement {
      const root = window.document.createElement('div');
      window.document.body.replaceChildren(root);
      return root;
    }
  }, PUBLIC_RENDER_API_MODULE);

  expect(result.length).toBeGreaterThanOrEqual(2);
  expect(result[0]).toMatchObject({
    sectionIndex: '0',
    sectionPageNumber: '1',
    headerRId: 'rId-header-one',
  });
  expect(result[0].headerText).toContain('First section header');
  expect(result[0].headerTop).toBeCloseTo(0, 0);

  const second = result.find((entry) => entry.sectionIndex === '1');
  expect(second).toBeDefined();
  expect(second).toMatchObject({
    sectionPageNumber: '1',
    headerRId: 'rId-header-two',
  });
  expect(second!.headerText).toContain('Second section header');
  expect(second!.headerTop).toBeCloseTo(48, 0);
  expect(second!.hasPageBorder).toBe(false);
});
