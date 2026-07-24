// Shared Playwright helpers for the one-surface interaction gates
// (interactive-paginated-editing M2.3).
//
// The rule these helpers exist to enforce: a browser gate MUST locate its click
// target by public attribute and click that element's own center. Hardcoded page
// coordinates drift the moment layout changes, and a click that lands on
// whitespace or a margin is a declared no-op in the 5.6a subset — so a spec
// aimed at one would pass while proving nothing.

import { expect, type Locator, type Page } from '@playwright/test';

/** Public attribute stamped on the first editable body glyph. */
export const ONE_SURFACE_CLICK_TARGET = 'one-surface-click-target';

/** Public attribute stamped on the painted caret overlay. */
export const ONE_SURFACE_CARET = 'one-surface-caret';

export function clickTarget(page: Page): Locator {
  return page.getByTestId(ONE_SURFACE_CLICK_TARGET);
}

export function caretOverlay(page: Page): Locator {
  return page.getByTestId(ONE_SURFACE_CARET);
}

/** Wait until the engine has painted a click target on a real glyph. */
export async function waitForClickTarget(page: Page): Promise<Locator> {
  const target = clickTarget(page);
  await expect(target).toBeVisible();
  await expect(target).not.toHaveText(/^\s*$/);
  return target;
}

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The center of the click target in client coordinates, read from the live
 * bounding box. Never a constant.
 */
export async function clickTargetCenter(page: Page): Promise<ClientPoint> {
  const target = await waitForClickTarget(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('one-surface click target has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A point at a given fraction across the click target, for tests that need a
 * caret at a specific side of the glyph (shift-click, drag endpoints).
 */
export async function clickTargetPointAt(page: Page, fractionX: number, fractionY = 0.5): Promise<ClientPoint> {
  const target = await waitForClickTarget(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('one-surface click target has no bounding box');
  return { x: box.x + box.width * fractionX, y: box.y + box.height * fractionY };
}

/** Click the center of the first editable body glyph with a real mouse event. */
export async function clickFirstGlyph(page: Page, options: { clickCount?: number; modifiers?: ('Shift')[] } = {}): Promise<void> {
  const point = await clickTargetCenter(page);
  await page.mouse.click(point.x, point.y, {
    ...(options.clickCount ? { clickCount: options.clickCount } : {}),
  });
  if (options.modifiers?.includes('Shift')) {
    throw new Error('use shiftClickAt for shift-extended clicks so the modifier is held across the press');
  }
}

/** Shift-click a point, holding the modifier across press and release. */
export async function shiftClickAt(page: Page, point: ClientPoint): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
}

/** Drag from one client point to another with intermediate moves. */
export async function dragBetween(page: Page, from: ClientPoint, to: ClientPoint, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

/** Assert a painted caret exists — proof the engine, not the test, placed it. */
export async function expectCaretPainted(page: Page): Promise<void> {
  await expect(caretOverlay(page)).toBeVisible();
}
