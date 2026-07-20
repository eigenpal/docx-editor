import { expect, test } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function findShortcut(page: import('@playwright/test').Page): Promise<string> {
  const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
  return isMac ? 'Meta+f' : 'Control+f';
}

async function getEditorScrollTop(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="docx-editor"]');
    if (!root) return 0;
    const scroller = Array.from(root.querySelectorAll<HTMLElement>('*')).find((el) => {
      const style = getComputedStyle(el);
      return (
        el.scrollHeight > el.clientHeight + 100 &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll')
      );
    });
    return scroller?.scrollTop ?? 0;
  });
}

async function findUniqueLastPagePhrase(page: import('@playwright/test').Page): Promise<string> {
  const phrase = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.layout-page'));
    const lastPage = pages[pages.length - 1];
    if (!lastPage) return null;
    const lastPageText = lastPage.textContent ?? '';
    if (lastPageText.includes('scrollToPage(3)')) return 'scrollToPage(3)';

    // Prefer uniqueness against earlier *painted pages*, not agentGetDocumentText:
    // the demo TOC repeats body phrases, so document-wide uniqueness is often empty.
    const earlierText = pages
      .slice(0, -1)
      .map((p) => p.textContent ?? '')
      .join('\n');

    const spans = Array.from(
      lastPage.querySelectorAll<HTMLElement>(
        '.layout-page-content span[data-doc-from][data-doc-to]'
      )
    );
    for (const span of spans) {
      const text = (span.textContent ?? '').trim();
      if (text.length < 24) continue;
      for (let start = 0; start <= Math.min(12, text.length - 24); start += 1) {
        const candidate = text.slice(start, Math.min(text.length, start + 32)).trim();
        if (candidate.length < 20) continue;
        if (!earlierText.includes(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  });

  expect(phrase, 'demo document should expose a unique phrase on the last page').toBeTruthy();
  return phrase!;
}

test.describe('Find/replace shortcuts', () => {
  test('opens editor find by default', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await page.keyboard.press(await findShortcut(page));

    await editor.findReplaceDialog.waitFor();
  });

  test('can leave native browser find shortcut alone', async ({ page }) => {
    await page.goto('/?e2e=1&disableFindReplaceShortcuts=1');
    const editor = new EditorPage(page);
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await page.keyboard.press(await findShortcut(page));

    await expect(editor.findReplaceDialog).toHaveCount(0);
  });

  test('find scrolls the paged view to a match on a later page', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    const totalPages = await page.waitForFunction(
      () => {
        const total = window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0;
        return total > 1 ? total : false;
      },
      { timeout: 10000 }
    );

    await page.evaluate(
      (pageNumber) => {
        window.__DOCX_EDITOR_E2E__?.scrollToPage(pageNumber);
      },
      await totalPages.jsonValue()
    );
    await page.waitForFunction(() => {
      const pages = document.querySelectorAll<HTMLElement>('.layout-page');
      const lastPage = pages[pages.length - 1];
      if (!lastPage) return false;
      const rect = lastPage.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });

    const phrase = await findUniqueLastPagePhrase(page);
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="docx-editor"]');
      const scroller = root
        ? Array.from(root.querySelectorAll<HTMLElement>('*')).find((el) => {
            const style = getComputedStyle(el);
            return (
              el.scrollHeight > el.clientHeight + 100 &&
              (style.overflowY === 'auto' || style.overflowY === 'scroll')
            );
          })
        : null;
      scroller?.scrollTo({ top: 0 });
    });
    const initialScrollTop = await getEditorScrollTop(page);

    await page.keyboard.press(await findShortcut(page));
    await editor.findReplaceDialog.waitFor();
    await page.locator('#find-text').fill(phrase);
    await page.locator('#find-text').press('Enter');

    await page.waitForFunction(
      (start) => {
        const root = document.querySelector<HTMLElement>('[data-testid="docx-editor"]');
        if (!root) return false;
        const scroller = Array.from(root.querySelectorAll<HTMLElement>('*')).find((el) => {
          const style = getComputedStyle(el);
          return (
            el.scrollHeight > el.clientHeight + 100 &&
            (style.overflowY === 'auto' || style.overflowY === 'scroll')
          );
        });
        return (scroller?.scrollTop ?? 0) > start + 50;
      },
      initialScrollTop,
      { timeout: 10000 }
    );
    await page.waitForFunction(
      (expected) => window.__DOCX_EDITOR_E2E__?.agentSelection()?.selectedText === expected,
      phrase
    );
  });

  test('searches as the find term changes instead of reusing previous matches', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
    await editor.typeText('alpha beta gamma');

    await page.keyboard.press(await findShortcut(page));
    await editor.findReplaceDialog.waitFor();

    await page.locator('#find-text').fill('alpha');
    await page.waitForFunction(
      () => window.__DOCX_EDITOR_E2E__?.agentSelection()?.selectedText === 'alpha'
    );

    await page.locator('#find-text').fill('gamma');
    await page.waitForFunction(
      () => window.__DOCX_EDITOR_E2E__?.agentSelection()?.selectedText === 'gamma'
    );
  });

  test('enter advances live search results without resetting to the first match', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
    await editor.typeText('alpha beta alpha gamma');

    await page.keyboard.press(await findShortcut(page));
    await editor.findReplaceDialog.waitFor();

    await page.locator('#find-text').fill('alpha');
    await page.waitForFunction(() => {
      const selection = window.__DOCX_EDITOR_E2E__?.agentSelection();
      return selection?.selectedText === 'alpha' && selection.before === '';
    });

    await page.locator('#find-text').press('Enter');
    await page.waitForFunction(() => {
      const selection = window.__DOCX_EDITOR_E2E__?.agentSelection();
      return selection?.selectedText === 'alpha' && selection.before === 'alpha beta ';
    });
    await page.waitForTimeout(400);
    await expect
      .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentSelection()?.before ?? ''))
      .toBe('alpha beta ');
  });
});
