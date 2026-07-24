// Paired one-surface interaction gate (interactive-paginated-editing 6.5).
//
// The React and Vue specs each prove their own adapter works. This one proves
// they behave the SAME. It runs one scenario set against both adapters and
// compares the results to each other, so a divergence fails here even when both
// adapters pass their own suite — which is exactly the failure mode a
// paired-preview claim has to rule out.

import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { clickTargetPointAt, waitForClickTarget } from './oneSurfaceHelpers.ts';

const ADAPTERS = [
  { name: 'react', url: 'http://localhost:5273' },
  { name: 'vue', url: 'http://localhost:5274' },
] as const;

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

async function mount(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/?realAdapter=1`);
  await page.waitForFunction(() => !!window.__docxAdapterEditor);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  await waitForClickTarget(page);
}

async function paintedText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-page-index] .ep-one-surface__content > div')]
      .map((el) => el.textContent ?? '')
      .join('')
  );
}

async function selectionOffsets(page: Page): Promise<{ anchor: number | null; head: number | null }> {
  return page.evaluate(() => {
    const sel = window.__docxAdapterEditor!.getInteractionFrame().selection;
    const read = (t: unknown): number | null =>
      t && (t as { kind?: string }).kind === 'text' ? (t as { graphemeOffset: number }).graphemeOffset : null;
    return { anchor: read(sel?.anchor), head: read(sel?.head) };
  });
}

/**
 * Run one scenario against every adapter and return the per-adapter results,
 * so the caller can assert they agree.
 */
async function acrossAdapters<T>(
  browser: import('@playwright/test').Browser,
  scenario: (page: Page) => Promise<T>,
): Promise<Record<string, T>> {
  const results: Record<string, T> = {};
  for (const adapter of ADAPTERS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mount(page, adapter.url);
    results[adapter.name] = await scenario(page);
    await context.close();
  }
  return results;
}

test.describe('paired one-surface interaction (task 6.5)', () => {
  test('both adapters expose the same public interaction surface', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid]')].map((el) => (el as HTMLElement).dataset.testid).sort(),
      ),
    );
    // Same testids means a browser gate written against one adapter runs
    // unchanged against the other.
    expect(results.vue).toEqual(results.react);
    expect(results.react).toContain('one-surface-click-target');
  });

  test('a click at the same fraction of the same glyph lands on the same offset', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const offsets: number[] = [];
      for (const fraction of [0.05, 0.4, 0.75, 0.98]) {
        const point = await clickTargetPointAt(page, fraction);
        await page.mouse.click(point.x, point.y);
        offsets.push((await selectionOffsets(page)).head ?? -1);
      }
      return offsets;
    });
    expect(results.vue).toEqual(results.react);
    // And the offsets must actually advance, or both adapters agree on nothing.
    expect(results.react[0]).toBeLessThan(results.react[3]!);
  });

  test('typing the same text at the same place produces the same document', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const before = await paintedText(page);
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type('Paired');
      await expect.poll(async () => await paintedText(page)).toContain('Paired');
      return { before, after: await paintedText(page) };
    });
    expect(results.vue).toEqual(results.react);
  });

  test('the same drag selects the same range', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const from = await clickTargetPointAt(page, 0.05);
      const to = await clickTargetPointAt(page, 0.95);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y);
      }
      await page.mouse.up();
      return selectionOffsets(page);
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.head).toBeGreaterThan(results.react.anchor!);
  });

  test('an unsupported command is refused with the same typed reason', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) =>
      page.evaluate(() => {
        const outcome = window.__docxAdapterEditor!.can({ type: 'toggleMark', mark: 'underline' });
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.code, reason: outcome.reason };
      }),
    );
    // A capability refusal must read identically, or one adapter's UI would
    // explain the limit differently from the other's.
    expect(results.vue).toEqual(results.react);
    expect(results.react.ok).toBe(false);
  });

  test('a margin click is refused identically and moves no caret in either adapter', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      const placed = await selectionOffsets(page);
      const outcome = await page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        const frame = editor.getInteractionFrame();
        const rect = document.querySelector('[data-page-index]')!.getBoundingClientRect();
        const result = editor.dispatchInteraction({
          kind: 'click',
          frameId: frame.id,
          clientPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height - 8 },
          clickCount: 1,
        }).outcome;
        return result.ok ? { ok: true } : { ok: false, code: result.code, reason: result.reason };
      });
      return { outcome, placed, after: await selectionOffsets(page) };
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.outcome.ok).toBe(false);
    expect(results.react.after).toEqual(results.react.placed);
  });

  test('an edit survives save and reopen identically in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type('Roundtrip');
      await expect.poll(async () => await paintedText(page)).toContain('Roundtrip');
      await page.evaluate(async () => {
        const editor = window.__docxAdapterEditor!;
        const saved = await editor.save();
        await editor.load(saved instanceof Uint8Array ? saved : new Uint8Array(saved as ArrayBuffer));
      });
      await expect.poll(async () => await paintedText(page)).toContain('Roundtrip');
      return paintedText(page);
    });
    expect(results.vue).toEqual(results.react);
  });
});
