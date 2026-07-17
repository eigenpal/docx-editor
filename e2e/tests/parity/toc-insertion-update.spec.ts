import { expect, forEachAdapter, openEditor } from './parity-fixture';

const TOC_UPDATE_LABEL = 'Update table of contents';

function paintedRefreshButton(body: import('@playwright/test').Locator) {
  return body.locator('[data-toc-refresh]:not([data-toc-refresh-proxy])');
}

function accessibleRefreshProxy(page: import('@playwright/test').Page) {
  return page.locator('[data-toc-refresh-proxy]');
}

async function loadDemoHeadings(page: import('@playwright/test').Page) {
  await expect
    .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentGetDocumentText() ?? ''))
    .toContain('Example');

  const headings = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const paragraphs =
      hook?.agentGetPageContent(1)?.paragraphs.filter((paragraph) => paragraph.text.trim()) ?? [];
    const first = paragraphs.find((paragraph) => paragraph.text.trim() === 'Example');
    const insertionPoint = paragraphs.find((paragraph) => paragraph.paraId !== first?.paraId);
    if (!hook || !first || !insertionPoint) return null;
    return {
      first: { paraId: first.paraId, text: first.text.trim() },
      insertionText: insertionPoint.text.trim(),
    };
  });
  expect(headings).not.toBeNull();
  return headings!;
}

async function insertTocBeforeHeading(
  page: import('@playwright/test').Page,
  body: import('@playwright/test').Locator,
  insertionText: string
) {
  await body.getByText(insertionText, { exact: true }).first().click();
  await page.keyboard.press('Home');
  await chooseInsertToc(page);
}

async function insertSecondToc(page: import('@playwright/test').Page) {
  await chooseInsertToc(page);
}

async function chooseInsertToc(page: import('@playwright/test').Page) {
  await expect(async () => {
    const item = page.getByRole('button', { name: 'Table of contents', exact: true });
    if (!(await item.isVisible())) {
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
    }
    await item.click({ timeout: 2000 });
  }).toPass({ timeout: 10000 });
}

async function hoverTocBoundary(refreshButton: import('@playwright/test').Locator) {
  await refreshButton.locator('xpath=..').hover({ force: true });
}

/** Viewport rects for the painted refresh button and its TOC boundary box. */
async function refreshGeometry(refreshButton: import('@playwright/test').Locator) {
  return refreshButton.evaluate((button) => {
    const read = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return { button: read(button), box: read(button.parentElement as HTMLElement) };
  });
}

/**
 * Geometry read once the TOC has stopped moving. An edit settles the TOC
 * asynchronously (page numbers get a second pass), so a rect sampled too early
 * goes stale and the pointer ends up aiming where the box no longer is.
 */
async function stableRefreshGeometry(refreshButton: import('@playwright/test').Locator) {
  let previous = '';
  let current = '';
  await expect
    .poll(
      async () => {
        previous = current;
        current = JSON.stringify(await refreshGeometry(refreshButton));
        return current !== '' && current === previous;
      },
      { timeout: 15000, intervals: [150] }
    )
    .toBe(true);
  return JSON.parse(current) as Awaited<ReturnType<typeof refreshGeometry>>;
}

/**
 * Whether the button would actually receive a click at the given point.
 * `toBeVisible` is too weak here: it ignores `opacity`, and `visibility`
 * lags behind on a transition, so a fully faded, unhittable button passes it.
 */
async function hitStateAt(
  refreshButton: import('@playwright/test').Locator,
  x: number,
  y: number
): Promise<{ opacity: string; pointerEvents: string; hitsButton: boolean }> {
  return refreshButton.evaluate(
    (button, [px, py]) => {
      const style = getComputedStyle(button);
      const hit = button.ownerDocument.elementFromPoint(px as number, py as number);
      return {
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        hitsButton: hit != null && (hit === button || button.contains(hit)),
      };
    },
    [x, y] as const
  );
}

function refreshButtonForPosition(body: import('@playwright/test').Locator, position: string) {
  return body
    .locator(`[data-toc-refresh][data-toc-position="${position}"]:not([data-toc-refresh-proxy])`)
    .first();
}

async function captureNextPagesReadyDetail(
  page: import('@playwright/test').Page,
  adapterName: 'react' | 'vue'
) {
  await page.evaluate((name) => {
    const pages = document.querySelector('.paged-editor__pages');
    if (!pages) throw new Error('Missing painted pages');
    const state = window as typeof window & { __pagesReadyDetailKeys?: string[] };
    state.__pagesReadyDetailKeys = undefined;
    pages.addEventListener(
      `docx-editor-${name}:painted-pages-ready`,
      (event) => {
        state.__pagesReadyDetailKeys = Object.keys((event as CustomEvent).detail).sort();
      },
      { once: true }
    );
  }, adapterName);
}

forEachAdapter('inserts and updates a painted table of contents', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const headings = await loadDemoHeadings(page);
  const body = page.locator('.layout-page-content');

  await captureNextPagesReadyDetail(page, adapter.name);
  await insertTocBeforeHeading(page, body, headings.insertionText);

  await expect(
    body.locator('.layout-block-sdt-label', { hasText: 'Table of Contents' })
  ).toHaveCount(1);

  // Insertion schedules its own update; this explicit call is either the
  // initial update or a verified no-op if that scheduled pass already landed.
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.updateTableOfContents() ?? false);
  const entryAnchor = body.locator('a').filter({ hasText: headings.first.text }).first();
  await expect(entryAnchor).toBeVisible();
  expect(await body.locator('a[href^="#_Toc"]').count()).toBeGreaterThanOrEqual(2);
  expect(await body.locator('.layout-run-tab').count()).toBeGreaterThan(0);

  await expect.poll(() => accessibleRefreshProxy(page).count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => paintedRefreshButton(body).count(), { timeout: 15000 }).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __pagesReadyDetailKeys?: string[] }).__pagesReadyDetailKeys
      )
    )
    .toEqual(['paintGeneration']);
  await expect(paintedRefreshButton(body)).toBeHidden();
  await expect.poll(() => accessibleRefreshProxy(page).count()).toBe(1);
  await expect(accessibleRefreshProxy(page)).toHaveAttribute('aria-label', TOC_UPDATE_LABEL);
  await expect(accessibleRefreshProxy(page)).not.toHaveAttribute('aria-hidden', 'true');
  await expect
    .poll(async () =>
      accessibleRefreshProxy(page).evaluate((btn) => {
        let node: HTMLElement | null = btn;
        while (node) {
          if (node.getAttribute('aria-hidden') === 'true') return true;
          node = node.parentElement;
        }
        return false;
      })
    )
    .toBe(false);

  // Manual refresh is available and dispatches even while advisory stale
  // detection considers this TOC current.
  const currentRefresh = paintedRefreshButton(body);
  await hoverTocBoundary(currentRefresh);
  await expect(currentRefresh).toBeVisible();
  await page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__?.getView?.();
    (
      window as typeof window & { __tocDocBeforeCurrentRefresh?: unknown }
    ).__tocDocBeforeCurrentRefresh = view?.state.doc;
  });
  await currentRefresh.click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = window.__DOCX_EDITOR_E2E__?.getView?.();
        return (
          view?.state.doc !==
          (window as typeof window & { __tocDocBeforeCurrentRefresh?: unknown })
            .__tocDocBeforeCurrentRefresh
        );
      })
    )
    .toBe(true);
  await expect(entryAnchor).toBeVisible();
  await expect.poll(() => paintedRefreshButton(body).count(), { timeout: 15000 }).toBe(1);

  const renamedText = 'Renamed Example';
  await body.getByText(headings.first.text, { exact: true }).first().click({ clickCount: 3 });
  await page.keyboard.type(renamedText);

  const refreshButton = paintedRefreshButton(body);
  await expect.poll(() => refreshButton.count()).toBe(1);
  await expect(refreshButton).toBeHidden();

  await hoverTocBoundary(refreshButton);
  await expect(refreshButton).toBeVisible();
  await expect(refreshButton).toHaveAttribute('aria-hidden', 'true');
  await expect(refreshButton).toHaveAttribute('tabindex', '-1');
  await expect(refreshButton).toHaveAttribute('title', TOC_UPDATE_LABEL);
  const selectionBeforeRefresh = await page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__?.getView?.();
    return view ? { from: view.state.selection.from, to: view.state.selection.to } : null;
  });
  expect(selectionBeforeRefresh).not.toBeNull();
  await refreshButton.click();
  expect(
    await page.evaluate(() => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      return view ? { from: view.state.selection.from, to: view.state.selection.to } : null;
    })
  ).toEqual(selectionBeforeRefresh);

  await expect(body.locator('a').filter({ hasText: renamedText }).first()).toBeVisible();
  await expect.poll(() => paintedRefreshButton(body).count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => accessibleRefreshProxy(page).count()).toBe(1);
  await expect(paintedRefreshButton(body)).toBeHidden();

  await body.getByText(headings.insertionText, { exact: true }).last().click();
  await page.keyboard.type(' extra');
  await expect.poll(() => paintedRefreshButton(body).count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => accessibleRefreshProxy(page).count()).toBe(1);
});

forEachAdapter(
  'keeps the TOC refresh button clickable as the pointer travels onto it',
  async (adapter, { page }) => {
    await openEditor(page, adapter);
    const headings = await loadDemoHeadings(page);
    const body = page.locator('.layout-page-content');

    await insertTocBeforeHeading(page, body, headings.insertionText);
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.updateTableOfContents());

    const renamedText = 'Pointer Travel Example';
    await body.getByText(headings.first.text, { exact: true }).first().click({ clickCount: 3 });
    await page.keyboard.type(renamedText);

    const refreshButton = paintedRefreshButton(body);
    await expect.poll(() => refreshButton.count(), { timeout: 15000 }).toBe(1);

    // Reveal the button with a real pointer over the TOC body — no force.
    const { box, button } = await stableRefreshGeometry(refreshButton);
    await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
    await expect(refreshButton).toBeVisible();

    // Walk the cursor left onto the button the way a user reaching for it does.
    // The button sits outside the boundary box, so every intermediate point must
    // keep it revealed; a dead gap here hides it before the click can land.
    const centerX = button.x + button.width / 2;
    const centerY = button.y + button.height / 2;
    await page.mouse.move(centerX, centerY, { steps: 24 });

    // The gutter between box and button must stay live all the way across.
    await expect
      .poll(async () => (await hitStateAt(refreshButton, centerX, centerY)).opacity)
      .toBe('1');
    expect(await hitStateAt(refreshButton, centerX, centerY)).toMatchObject({
      pointerEvents: 'auto',
      hitsButton: true,
    });

    // Click through the real pointer position rather than a forced hit.
    await page.mouse.down();
    await page.mouse.up();

    await expect(body.locator('a').filter({ hasText: renamedText }).first()).toBeVisible({
      timeout: 15000,
    });
  }
);

forEachAdapter('reveals and activates TOC refresh via keyboard', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const headings = await loadDemoHeadings(page);
  const body = page.locator('.layout-page-content');

  await insertTocBeforeHeading(page, body, headings.insertionText);
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.updateTableOfContents());

  await body.getByText(headings.first.text, { exact: true }).first().click({ clickCount: 3 });
  await page.keyboard.type('Keyboard Example');

  const refreshButton = paintedRefreshButton(body);
  const refreshProxy = accessibleRefreshProxy(page);
  await expect.poll(() => refreshButton.count()).toBe(1);
  await expect.poll(() => refreshProxy.count()).toBe(1);

  await hoverTocBoundary(refreshButton);
  await expect(refreshButton).toBeVisible();
  await refreshProxy.focus();
  await expect(refreshProxy).toBeFocused();
  const originalPosition = await refreshProxy.getAttribute('data-toc-position');
  await refreshProxy.evaluate((proxy) => {
    (window as typeof window & { __focusedTocProxy?: Element }).__focusedTocProxy = proxy;
  });
  await page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__?.getView?.();
    if (!view) throw new Error('Missing editor view');
    const paragraph = view.state.schema.node('paragraph', null, [
      view.state.schema.text('Inserted before TOC'),
    ]);
    view.dispatch(view.state.tr.insert(0, paragraph));
  });
  await expect
    .poll(() => refreshProxy.getAttribute('data-toc-position'), { timeout: 15000 })
    .not.toBe(originalPosition);
  await expect
    .poll(() =>
      refreshProxy.evaluate(
        (proxy) =>
          document.activeElement === proxy &&
          (window as typeof window & { __focusedTocProxy?: Element }).__focusedTocProxy === proxy
      )
    )
    .toBe(true);
  await page.mouse.move(0, 0);
  await expect(refreshButton).toBeVisible();
  await expect(refreshButton).toHaveClass(/layout-toc-refresh--proxy-focused/);
  await refreshProxy.press('Enter');

  await expect(body.locator('a').filter({ hasText: 'Keyboard Example' }).first()).toBeVisible({
    timeout: 15000,
  });
  await expect.poll(() => paintedRefreshButton(body).count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => refreshProxy.count()).toBe(1);
});

forEachAdapter('maps independent TOCs to matching refresh controls', async (adapter, { page }) => {
  await openEditor(page, adapter);
  const headings = await loadDemoHeadings(page);
  const body = page.locator('.layout-page-content');

  await insertTocBeforeHeading(page, body, headings.insertionText);
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.updateTableOfContents());

  await body.getByText(headings.insertionText, { exact: true }).last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await insertSecondToc(page);
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.updateTableOfContents());

  await expect(
    body.locator('.layout-block-sdt-label', { hasText: 'Table of Contents' })
  ).toHaveCount(2);

  await body.getByText(headings.first.text, { exact: true }).first().click({ clickCount: 3 });
  await page.keyboard.type('First TOC Only');

  const refreshButtons = paintedRefreshButton(body);
  const refreshProxies = accessibleRefreshProxy(page);
  await expect.poll(() => refreshButtons.count()).toBe(2);
  await expect.poll(() => refreshProxies.count()).toBe(2);
  const positions = await refreshProxies.evaluateAll(
    (buttons) =>
      buttons
        .map((button) => (button as HTMLElement).dataset.tocPosition)
        .filter(Boolean) as string[]
  );
  expect(new Set(positions).size).toBe(2);

  const [firstPosition] = positions;
  const firstRefresh = refreshButtonForPosition(body, firstPosition);
  await hoverTocBoundary(firstRefresh);
  await firstRefresh.click();

  await expect(body.locator('a').filter({ hasText: 'First TOC Only' }).first()).toBeVisible();
  await expect.poll(() => refreshProxies.count()).toBe(2);

  const remainingProxy = refreshProxies.nth(1);
  const remainingPosition = await remainingProxy.getAttribute('data-toc-position');
  expect(remainingPosition).not.toBeNull();
  await remainingProxy.focus();
  const remainingRefresh = refreshButtonForPosition(body, remainingPosition!);
  await expect(remainingRefresh).toHaveClass(/layout-toc-refresh--proxy-focused/);
  await remainingProxy.press('Space');
  await expect.poll(() => refreshButtons.count()).toBe(2);
  await expect.poll(() => refreshProxies.count()).toBe(2);
});
