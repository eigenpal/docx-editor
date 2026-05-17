/**
 * Parity test helpers — runs the same spec body against the React (5173)
 * and Vue (5174) demos so we catch divergence in the Agent SDK surface.
 *
 * Each test forks once per adapter; titles get a `[react]` / `[vue]`
 * suffix. Use `openAgentPanel(page, adapter, extraQuery)` to navigate
 * the demo and wait for the panel — covers both adapters' ready logic.
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const PARA_ID_FIXTURE = path.resolve('e2e/fixtures/example-with-image.docx');

export interface AdapterFixture {
  /** Stable identifier — appears in the test title. */
  name: 'react' | 'vue';
  /** Demo URL root for this adapter. */
  baseUrl: string;
  /**
   * In React, the agent panel auto-toggles via a toolbar button. In Vue,
   * the demo renders the panel inline (no toolbar toggle yet). When true,
   * the helper clicks "Open assistant" to reveal the panel.
   */
  needsToolbarToggle: boolean;
  /**
   * Selector that signals the editor finished mounting. React uses the
   * `data-testid="docx-editor"` shell; Vue exposes `.docx-editor-vue`.
   */
  readySelector: string;
}

const ADAPTERS: AdapterFixture[] = [
  {
    name: 'react',
    baseUrl: 'http://localhost:5173',
    needsToolbarToggle: true,
    readySelector: '[data-testid="docx-editor"]',
  },
  {
    name: 'vue',
    baseUrl: 'http://localhost:5174',
    needsToolbarToggle: false,
    readySelector: '.docx-editor-vue',
  },
];

/**
 * Navigate to the demo with `?agentPanel=1` and wait until the panel is
 * on screen. `extraQuery` appends extra params (e.g. `&agentTimeline=…`).
 * Replaces the per-spec gotoOpenPanel/gotoTimeline helpers.
 */
export async function openAgentPanel(
  page: Page,
  adapter: AdapterFixture,
  extraQuery = ''
): Promise<void> {
  await page.goto(`${adapter.baseUrl}/?e2e=1&agentPanel=1${extraQuery}`);
  await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
  if (adapter.needsToolbarToggle) {
    await page.getByRole('button', { name: 'Open assistant' }).click();
  }
  await expect(page.getByTestId('agent-panel')).toBeVisible();
}

/** Navigate to the editor-only demo and wait for the adapter shell. */
export async function openEditor(
  page: Page,
  adapter: AdapterFixture,
  extraQuery = ''
): Promise<void> {
  await page.goto(`${adapter.baseUrl}/?e2e=1${extraQuery}`);
  await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
  await expect(page.locator(adapter.readySelector)).toBeVisible();
  await expect(page.locator('.paged-editor__pages')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(PARA_ID_FIXTURE);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const pageCount = window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0;
          const firstParaId =
            window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ??
            window.__DOCX_EDITOR_E2E__
              ?.agentGetPageContent(1)
              ?.paragraphs.find((paragraph) => paragraph.text.trim().length > 0)?.paraId ??
            null;
          return pageCount > 0 && typeof firstParaId === 'string' && firstParaId.length > 0;
        }),
      { timeout: 25000 }
    )
    .toBe(true);
}

/**
 * Declare a test once, run it once per adapter. Each generated test gets
 * `[<adapter>]` appended to its title.
 */
export function forEachAdapter(
  title: string,
  body: (adapter: AdapterFixture, args: { page: Page }) => Promise<void>
): void {
  for (const adapter of ADAPTERS) {
    // First arg must literally destructure for Playwright's fixture
    // detection: `(args) =>` would fail "First argument must use the
    // object destructuring pattern".
    test(`${title} [${adapter.name}]`, ({ page }) => body(adapter, { page }));
  }
}

export { expect };
