import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const PAINTER_MODULE = `/@fs/${resolve('packages/core/src/painter-model/index.ts')}`;

test('virtualized pages repaint semantic body and same-height header edits', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (painterModule) => {
    const painter = (await import(painterModule)) as {
      indexNodesById(nodes: any[], metrics: any[]): Map<string, unknown>;
      paintPages(pages: any[], container: HTMLElement, options: Record<string, unknown>): string;
    };
    const paragraph = (id: string, text: string, docFrom: number, bold = false) => ({
      kind: 'paragraph',
      id,
      docFrom,
      docTo: docFrom + text.length,
      runs: [
        {
          kind: 'text',
          text,
          bold,
          docFrom,
          docTo: docFrom + text.length,
        },
      ],
    });
    const metric = {
      kind: 'paragraph',
      totalHeight: 20,
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 5,
          width: 50,
          ascent: 14,
          descent: 4,
          lineHeight: 20,
        },
      ],
    };
    const makeHeader = (text: string) => ({
      nodes: [paragraph('header', text, 1)],
      metrics: [metric],
      height: 20,
      flowHeight: 20,
      visualTop: 0,
      visualBottom: 20,
    });
    const pages = Array.from({ length: 9 }, (_, index) => {
      const docFrom = index * 10 + 1;
      return {
        number: index + 1,
        size: { w: 300, h: 400 },
        margins: { top: 40, right: 20, bottom: 40, left: 20 },
        fragments: [
          {
            kind: 'paragraph',
            nodeId: `body-${index}`,
            x: 0,
            y: 0,
            width: 260,
            height: 20,
            fromLine: 0,
            toLine: 1,
            docFrom,
            docTo: docFrom + 5,
          },
        ],
      };
    });
    let nodes = pages.map((_, index) => paragraph(`body-${index}`, 'alpha', index * 10 + 1));
    const metrics = pages.map(() => metric);
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    let paintedSignals = 0;
    container.addEventListener('painter:painted', () => paintedSignals++);

    const paint = (headerText: string) =>
      painter.paintPages(pages, container, {
        document,
        pageGap: 24,
        nodeLookup: painter.indexNodesById(nodes, metrics),
        headerContent: makeHeader(headerText),
      });

    paint('AAAAA');
    const initiallyRendered = [...container.querySelectorAll<HTMLElement>('.layout-page')].filter(
      (pageElement) => pageElement.childElementCount > 0
    ).length;

    nodes = nodes.map((node, index) =>
      index === 0 ? paragraph(node.id, 'omega', node.docFrom) : node
    );
    const sameLengthKind = paint('AAAAA');
    const sameLengthText =
      container.querySelector<HTMLElement>('[data-page-number="1"] .layout-page-content')
        ?.textContent ?? '';

    nodes = nodes.map((node, index) =>
      index === 1 ? paragraph(node.id, node.runs[0].text, node.docFrom, true) : node
    );
    const formattingKind = paint('AAAAA');
    const formattedRun = container.querySelector<HTMLElement>(
      '[data-page-number="2"] .layout-page-content .layout-run-text'
    );
    const formattedFontWeight = formattedRun ? getComputedStyle(formattedRun).fontWeight : '';

    const beforeHeaderHosts = [...container.querySelectorAll<HTMLElement>('.layout-page-header')]
      .filter((host) => host.closest<HTMLElement>('.layout-page')?.childElementCount)
      .map((host) => host.textContent ?? '');
    const headerKind = paint('BBBBB');
    const afterHeaderHosts = [
      ...container.querySelectorAll<HTMLElement>('.layout-page-header'),
    ].map((host) => host.textContent ?? '');
    pages[0].size.w = 360;
    pages[0].margins.left = 60;
    const geometryKind = paint('BBBBB');
    const resizedHeader = container.querySelector<HTMLElement>(
      '[data-page-number="1"] .layout-page-header'
    );

    return {
      initiallyRendered,
      sameLengthKind,
      sameLengthText,
      formattingKind,
      fontWeight: formattedFontWeight,
      headerKind,
      beforeHeaderHosts,
      afterHeaderHosts,
      geometryKind,
      resizedHeaderLeft: resizedHeader?.style.left,
      resizedHeaderWidth: resizedHeader?.style.width,
      paintedSignals,
      stillVirtualized:
        [...container.querySelectorAll<HTMLElement>('.layout-page')].filter(
          (pageElement) => pageElement.childElementCount === 0
        ).length > 0,
    };
  }, PAINTER_MODULE);

  expect(result.initiallyRendered).toBeGreaterThan(0);
  expect(result.initiallyRendered).toBeLessThan(9);
  expect(result.sameLengthKind).toBe('incremental');
  expect(result.sameLengthText).toContain('omega');
  expect(result.formattingKind).toBe('incremental');
  expect(Number(result.fontWeight)).toBeGreaterThanOrEqual(600);
  expect(result.headerKind).toBe('incremental');
  expect(result.beforeHeaderHosts.length).toBe(result.initiallyRendered);
  expect(result.beforeHeaderHosts.every((text) => text.includes('AAAAA'))).toBe(true);
  expect(result.afterHeaderHosts).toHaveLength(result.initiallyRendered);
  expect(result.afterHeaderHosts.every((text) => text.includes('BBBBB'))).toBe(true);
  expect(result.geometryKind).toBe('incremental');
  expect(result.resizedHeaderLeft).toBe('60px');
  expect(result.resizedHeaderWidth).toBe('280px');
  expect(result.paintedSignals).toBe(5);
  expect(result.stillVirtualized).toBe(true);
});

test('virtualized pages repaint section-specific header furniture', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (painterModule) => {
    const painter = (await import(painterModule)) as {
      indexNodesById(nodes: any[], metrics: any[]): Map<string, unknown>;
      paintPages(pages: any[], container: HTMLElement, options: Record<string, unknown>): string;
      registerPageFurniture(page: any, furniture: Record<string, unknown>): void;
    };
    const paragraph = (id: string, text: string) => ({
      kind: 'paragraph',
      id,
      runs: [{ kind: 'text', text, docFrom: 1, docTo: text.length + 1 }],
    });
    const metric = {
      kind: 'paragraph',
      totalHeight: 20,
      lines: [
        {
          fromRun: 0,
          fromChar: 0,
          toRun: 0,
          toChar: 5,
          width: 50,
          ascent: 14,
          descent: 4,
          lineHeight: 20,
        },
      ],
    };
    const header = (text: string) => ({
      nodes: [paragraph(`header-${text}`, text)],
      metrics: [metric],
      height: 20,
      flowHeight: 20,
      visualTop: 0,
      visualBottom: 20,
    });
    const pages = Array.from({ length: 9 }, (_, index) => ({
      number: index + 1,
      size: { w: 300, h: 400 },
      margins: { top: 40, right: 20, bottom: 40, left: 20 },
      fragments: [
        {
          kind: 'paragraph',
          nodeId: `body-${index}`,
          x: 0,
          y: 0,
          width: 260,
          height: 20,
          fromLine: 0,
          toLine: 1,
          docFrom: index * 10 + 1,
          docTo: index * 10 + 6,
        },
      ],
    }));
    const nodes = pages.map((_, index) => paragraph(`body-${index}`, 'alpha'));
    const furniture = (text: string, sectionIndex: number) => ({
      sectionIndex,
      sectionPageNumber: 1,
      headerRId: `rId-${text}`,
      footerRId: null,
      headerVariant: 'default',
      footerVariant: 'default',
      headerContent: header(text),
      headerDistance: 0,
      footerDistance: 48,
    });
    for (const pageData of pages) painter.registerPageFurniture(pageData, furniture('AAAAA', 0));

    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const options = {
      document,
      pageGap: 24,
      nodeLookup: painter.indexNodesById(
        nodes,
        pages.map(() => metric)
      ),
    };
    painter.paintPages(pages, container, options);
    const before =
      container.querySelector<HTMLElement>('[data-page-number="1"] .layout-page-header')
        ?.textContent ?? '';

    painter.registerPageFurniture(pages[0], furniture('BBBBB', 1));
    const updateKind = painter.paintPages(pages, container, options);
    const first =
      container.querySelector<HTMLElement>('[data-page-number="1"] .layout-page-header')
        ?.textContent ?? '';
    const second =
      container.querySelector<HTMLElement>('[data-page-number="2"] .layout-page-header')
        ?.textContent ?? '';
    const firstSection =
      container.querySelector<HTMLElement>('[data-page-number="1"]')?.dataset.sectionIndex;

    return { before, first, second, firstSection, updateKind };
  }, PAINTER_MODULE);

  expect(result.before).toContain('AAAAA');
  expect(result.updateKind).toBe('incremental');
  expect(result.first).toContain('BBBBB');
  expect(result.second).toContain('AAAAA');
  expect(result.firstSection).toBe('1');
});
