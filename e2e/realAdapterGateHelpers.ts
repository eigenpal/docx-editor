// Shared Playwright helpers for production-adapter input-host gate (interactive-paginated 4.8).

import { expect, type Page } from '@playwright/test';
import type { EditorDriver } from '@docx-editor.dev/core-contract/editor';

export function countSubstring(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

declare global {
  interface Window {
    __docxAdapterDriver?: EditorDriver;
    __docxAdapterHarness?: {
      setZoom(zoom: number): void;
      getZoom(): number;
    };
  }
}

/**
 * Mount the real adapter on a PINNED fixture (M6D.1 follow-up).
 *
 * This gate proves the hidden input-host mechanism, not which document the demo opens by
 * default. When M6D.1 changed the React default to the comprehensive fixture, every
 * assertion here — written against `editable-sample.docx` content — went red. A gate must
 * control its own input rather than inherit a product default that is free to change.
 */
export async function mountRealAdapter(page: Page, baseUrl: string, query = 'realAdapter=1'): Promise<void> {
  const pinned = query.includes('fixture=') ? query : `${query}&fixture=editable-sample.docx`;
  await page.goto(`${baseUrl}/?${pinned}`);
  await page.waitForFunction(() => !!window.__docxAdapterDriver);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
}

export async function assertSingleOwnerTree(page: Page, requiredText?: string): Promise<string> {
  expect(await page.locator('[contenteditable="true"]').count()).toBe(1);
  expect(await page.locator('[role="document"]').count()).toBe(0);
  const tree = await page.locator('[data-docx-input-host-mount]').ariaSnapshot();
  if (requiredText) {
    expect(countSubstring(tree, requiredText)).toBe(1);
  }
  return tree;
}

export async function authorizeCaret(page: Page, blockIndex: number, graphemeOffset: number): Promise<void> {
  const outcome = await page.evaluate(
    ({ blockIndex, graphemeOffset }) => window.__docxAdapterDriver!.authorizeCaret(blockIndex, graphemeOffset),
    { blockIndex, graphemeOffset },
  );
  expect(outcome.ok).toBe(true);
}

export async function paragraphText(page: Page, blockIndex: number): Promise<string> {
  return page.evaluate(({ blockIndex }) => {
    const entries = window.__docxAdapterDriver!.accessibilityObservation().entries.filter((e) => e.role === 'editableParagraph');
    return entries[blockIndex]?.text ?? '';
  }, { blockIndex });
}

export async function selectionIdentity(page: Page): Promise<{ blockId: string; anchorOffset: number; headOffset: number } | null> {
  return page.evaluate(() => {
    const sel = window.__docxAdapterDriver!.accessibilityObservation().selection;
    if (!sel || sel.anchor.kind !== 'text' || sel.head.kind !== 'text') return null;
    return {
      blockId: sel.anchor.identity!.blockId,
      anchorOffset: sel.anchor.graphemeOffset!,
      headOffset: sel.head.graphemeOffset!,
    };
  });
}

export async function assertSelectionIdentity(
  page: Page,
  expected: { blockId: string; anchorOffset: number; headOffset: number },
): Promise<void> {
  await expect.poll(() => selectionIdentity(page)).toEqual(expected);
}

export async function blurEditable(page: Page): Promise<void> {
  await page.locator('[contenteditable="true"]').blur();
}

export async function driverFocus(page: Page): Promise<void> {
  const outcome = await page.evaluate(() => window.__docxAdapterDriver!.focus());
  expect(outcome.ok).toBe(true);
}

export async function assertBlurredWithRetainedSelection(
  page: Page,
  expected: { blockId: string; anchorOffset: number; headOffset: number },
  requiredText?: string,
): Promise<void> {
  expect(await page.evaluate(() => window.__docxAdapterDriver!.accessibilityObservation().focus.focused)).toBe(false);
  await assertSelectionIdentity(page, expected);
  await assertSingleOwnerTree(page, requiredText);
}

export async function assertRefocusedViaDriver(
  page: Page,
  expected: { blockId: string; anchorOffset: number; headOffset: number },
  requiredText?: string,
): Promise<void> {
  expect(await page.evaluate(() => window.__docxAdapterDriver!.accessibilityObservation().focus.focused)).toBe(true);
  await assertSelectionIdentity(page, expected);
  await assertCaretPlacement(page);
  await assertSingleOwnerTree(page, requiredText);
  expect(await page.locator('[contenteditable="true"]')).toHaveCount(1);
}

export async function assertInputHostShell(page: Page): Promise<void> {
  const clip = page.locator('[data-docx-input-host-clip]');
  await expect(clip).toHaveCount(1);
  const styles = await clip.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      display: computed.display,
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
      width: parseFloat(computed.width),
      height: parseFloat(computed.height),
    };
  });
  expect(styles.display).not.toBe('none');
  expect(parseFloat(styles.opacity)).toBe(0);
  expect(styles.pointerEvents).toBe('none');
  expect(styles.width).toBeGreaterThanOrEqual(2);
  expect(styles.height).toBeGreaterThanOrEqual(16);
}

export async function assertCaretPlacement(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const placement = await page.evaluate(() => {
        const driver = window.__docxAdapterDriver!;
        return {
          reason: driver.inputHostObservation()?.placementReason ?? null,
          caret: driver.caretClientRect(),
          focus: driver.accessibilityObservation().focus.focused,
          selection: driver.accessibilityObservation().selection,
          host: driver.inputHostObservation()?.clientRect ?? null,
        };
      });
      if (placement.reason !== 'applied' || !placement.caret || !placement.focus || !placement.selection || !placement.host) {
        return null;
      }
      const dx = Math.abs(placement.host.x - placement.caret.x);
      const dy = Math.abs(placement.host.y - placement.caret.y);
      if (dx >= 3 || dy >= 3) return null;
      return placement;
    })
    .not.toBeNull();

  // Both values compared above are computed in JS: the rect the engine ASKED
  // for, against the rect it believes the caret occupies. That pair agrees even
  // when the DOM disagrees with both — a `contain`, `transform`, or `filter` on
  // any ancestor makes the host a containing block for its own fixed-positioned
  // clip shell and silently relocates it. That exact bug shipped in the
  // one-surface stylesheet and this gate could not see it, so the real rendered
  // position is now asserted too.
  await assertInputHostRenderedAtCaret(page);
}

/**
 * The clip shell's ACTUAL `getBoundingClientRect()` versus the caret's client
 * rect. Reads the DOM, so it catches an ancestor that has quietly changed what
 * `position: fixed` resolves against.
 */
export async function assertInputHostRenderedAtCaret(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const shell = document.querySelector('[data-docx-input-host-clip]');
        const caret = window.__docxAdapterDriver!.caretClientRect();
        if (!shell || !caret) return null;
        const rendered = shell.getBoundingClientRect();
        return {
          dx: Math.round(Math.abs(rendered.x - caret.x)),
          dy: Math.round(Math.abs(rendered.y - caret.y)),
        };
      }),
    )
    // Same 3px tolerance as the requested-rect comparison.
    .toMatchObject({ dx: expect.any(Number), dy: expect.any(Number) });

  const drift = await page.evaluate(() => {
    const shell = document.querySelector('[data-docx-input-host-clip]')!;
    const caret = window.__docxAdapterDriver!.caretClientRect()!;
    const rendered = shell.getBoundingClientRect();
    return { dx: Math.abs(rendered.x - caret.x), dy: Math.abs(rendered.y - caret.y) };
  });
  expect(drift.dx, 'rendered input host drifted horizontally from the caret').toBeLessThan(3);
  expect(drift.dy, 'rendered input host drifted vertically from the caret').toBeLessThan(3);
}

export async function assertAppliedPlacementState(
  page: Page,
  options: { requiredText?: string; selectionBlockId?: string } = {},
): Promise<void> {
  await assertCaretPlacement(page);
  await assertSingleOwnerTree(page, options.requiredText);
  if (options.selectionBlockId) {
    const identity = await selectionIdentity(page);
    expect(identity?.blockId).toBe(options.selectionBlockId);
  }
}

export async function assertPaintedPagesHidden(page: Page): Promise<void> {
  expect(await page.locator('[data-page-index]').first().evaluate((el) => el.closest('[aria-hidden="true"]') !== null)).toBe(true);
  expect(await page.locator('[data-docx-painted-pages-assistive="presentation-only"]').count()).toBeGreaterThan(0);
}

export async function scrollEditor(page: Page, top: number): Promise<void> {
  await page.getByTestId('docx-editor-scroll').evaluate((el, y) => {
    el.scrollTop = y;
  }, top);
}

export async function setHarnessZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => window.__docxAdapterHarness!.setZoom(z), zoom);
  await expect.poll(() => page.evaluate(() => window.__docxAdapterHarness!.getZoom())).toBe(zoom);
  await page.evaluate(() => window.__docxAdapterDriver!.relayout());
}
