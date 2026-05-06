import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('issue #319 — section geometry & pagination', () => {
  test('mixed portrait/landscape doc renders without phantom empty pages', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/issue-319-sections.docx');
    await page.waitForTimeout(2000);

    // Read the layout state directly so the assertion isn't affected by
    // page virtualization (off-screen pages aren't painted but still
    // carry their fragments).
    const pages = await page.evaluate(() => {
      const container = document.querySelector('.layout-page')?.parentElement as
        | (HTMLElement & {
            __pageRenderState?: {
              pageDataMap: Map<HTMLElement, { page: { fragments: unknown[] } }>;
              pageCursors: { element: HTMLElement }[];
            };
          })
        | null;
      const state = container?.__pageRenderState;
      if (!state) {
        return Array.from(document.querySelectorAll('.layout-page')).map((p) => {
          const r = (p as HTMLElement).getBoundingClientRect();
          return {
            orient: r.width > r.height ? 'landscape' : 'portrait',
            empty: (p.textContent || '').replace(/\s+/g, '').length === 0,
          };
        });
      }
      return state.pageCursors.map((ps) => {
        const data = state.pageDataMap.get(ps.element);
        const fragmentCount = data?.page?.fragments?.length ?? 0;
        const r = ps.element.getBoundingClientRect();
        return {
          orient: r.width > r.height ? 'landscape' : 'portrait',
          empty: fragmentCount === 0,
        };
      });
    });

    // Section break + leading page-break-before paragraph used to leave a
    // phantom empty landscape page between the portrait body and the
    // landscape attachment.
    const phantomLandscapeBetweenContent = pages.findIndex((p, i) => {
      if (i === 0 || i === pages.length - 1) return false;
      return p.empty && pages[i - 1].orient !== p.orient;
    });
    expect(phantomLandscapeBetweenContent).toBe(-1);

    expect(pages.some((p) => p.orient === 'portrait')).toBe(true);
    expect(pages.some((p) => p.orient === 'landscape')).toBe(true);
  });
});
