import { expect, test, type Locator, type Page } from '@playwright/test';
import { performance as nodePerformance } from 'node:perf_hooks';

const PORT = Number.parseInt(process.env.COLLAB_E2E_PORT ?? '5331', 10);
const ORIGIN = `http://localhost:${PORT}`;
const CONNECT = /^Connect$/;
const SCROLLER = '.docx-editor__scroll-container';
const TYPE_EVENTS = 80;
const BACKSPACE_EVENTS = 80;
const BOLD_TOGGLES = 12;
const TYPEOVER_EVENTS = 40;
const BURST_HZ = 30;
const ELIGIBLE_MEDIAN_MS = 16.7;
const ELIGIBLE_P95_MS = 33.4;
const RATIO = 2;

declare global {
  interface Window {
    __COLLAB_PERF__?: {
      stop(): {
        readonly keydowns: number;
        readonly beforeInputs: number;
        readonly handlerMs: number[];
        readonly presentationMs: number[];
        readonly frameGapsMs: number[];
        readonly heapStart: number | null;
        readonly heapEnd: number | null;
      };
    };
  }
}

interface Timing {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

interface GestureRow {
  readonly gesture: string;
  readonly requested: number;
  readonly processed: number;
  readonly handler: Timing;
  readonly presentation: Timing;
  readonly maxFrameGapMs: number;
  readonly heapDeltaBytes: number | null;
}

function summarize(values: readonly number[]): Timing {
  if (values.length === 0) return { medianMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted[sorted.length - 1] ?? 0 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEditor(page: Page, url = ORIGIN): Promise<void> {
  await page.goto(url, { waitUntil: 'commit' });
  await expect(page.getByRole('button', { name: CONNECT })).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('[data-paragraph-id]:visible').first()).toBeVisible({
    timeout: 180_000,
  });
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: CONNECT }).click();
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await dialog.getByRole('button', { name: /Share this document/i }).click();
  const connected = page.getByRole('dialog', { name: 'Collaboration room' });
  await expect(connected.getByText('Connected', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  const invite = await connected.getByLabel('Invite link').inputValue();
  await connected.getByRole('button', { name: 'Done' }).click();
  await expect(connected).toHaveCount(0);
  return invite;
}

async function joinRoom(page: Page, invite: string, name: string): Promise<void> {
  await waitForEditor(page, invite);
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 45_000 });
}

async function expectParticipantCount(page: Page, count: number): Promise<void> {
  await expect(page.getByRole('button', { name: `${count} online` })).toBeVisible({
    timeout: 20_000,
  });
}

async function firstTextParagraph(page: Page): Promise<Locator> {
  const locator = page
    .locator('.docx-page-content .docx-paragraph-fragment[data-paragraph-id]:visible')
    .filter({ hasText: /\S/ })
    .first();
  await expect(locator).toBeVisible();
  return locator;
}

async function firstUnboldedParagraph(page: Page): Promise<Locator> {
  const candidates = page.locator('[data-paragraph-id]:visible').filter({ hasText: /\S/ });
  await expect(candidates.first()).toBeVisible();
  const limit = Math.min(await candidates.count(), 40);
  for (let index = 0; index < limit; index += 1) {
    const locator = candidates.nth(index);
    const weight = await locator.evaluate((element) => {
      let heaviest = 0;
      for (const node of [element, ...Array.from(element.querySelectorAll('*'))]) {
        const value = Number.parseInt(getComputedStyle(node as Element).fontWeight, 10);
        if (Number.isFinite(value) && value > heaviest) heaviest = value;
      }
      return heaviest;
    });
    const text = (await locator.textContent()) ?? '';
    if (weight < 600 && text.trim().length >= 4) return locator;
  }
  return firstTextParagraph(page);
}

async function nudgeScroller(page: Page): Promise<void> {
  await page
    .locator(SCROLLER)
    .first()
    .evaluate((element) => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    });
}

async function firstTableCellParagraph(page: Page): Promise<Locator> {
  const scroller = page.locator(SCROLLER).first();
  await expect(scroller).toBeVisible();
  const locator = page
    .locator(
      '.docx-table-cell:not([data-v-merge-continue]) .docx-paragraph-fragment[data-paragraph-id]'
    )
    .filter({ hasText: /\S/ });
  for (let step = 0; step < 80; step += 1) {
    try {
      await expect(locator.first()).toBeVisible({ timeout: 750 });
      await locator.first().scrollIntoViewIfNeeded();
      await nudgeScroller(page);
      return locator.first();
    } catch {
      const moved = await scroller.evaluate((element) => {
        const before = element.scrollTop;
        element.scrollTop = Math.min(
          element.scrollTop + element.clientHeight * 0.9,
          element.scrollHeight
        );
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
        return element.scrollTop !== before;
      });
      if (!moved) break;
    }
  }
  await expect(locator.first()).toBeVisible({ timeout: 20_000 });
  return locator.first();
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const handlerMs: number[] = [];
    const presentationMs: number[] = [];
    const frameGapsMs: number[] = [];
    const started = new WeakMap<Event, number>();
    const installedAt = performance.now();
    let previousFrame = installedAt;
    let keydowns = 0;
    let beforeInputs = 0;
    let stopped = false;
    const memoryOf = (): number | null => {
      const memory = (
        performance as Performance & { memory?: { readonly usedJSHeapSize: number } }
      ).memory;
      return memory?.usedJSHeapSize ?? null;
    };
    const heapStart = memoryOf();
    const begin = (event: Event): void => {
      if (!event.isTrusted) return;
      const start = performance.now();
      started.set(event, start);
      if (event.type === 'keydown') keydowns += 1;
      else beforeInputs += 1;
      requestAnimationFrame(() => presentationMs.push(performance.now() - start));
    };
    const end = (event: Event): void => {
      const start = started.get(event);
      if (start !== undefined) handlerMs.push(performance.now() - start);
    };
    document.addEventListener('keydown', begin, { capture: true });
    document.addEventListener('keydown', end);
    document.addEventListener('beforeinput', begin, { capture: true });
    document.addEventListener('beforeinput', end);
    const sampleFrame = (now: number): void => {
      if (stopped) return;
      frameGapsMs.push(now - previousFrame);
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
    window.__COLLAB_PERF__ = {
      stop() {
        stopped = true;
        document.removeEventListener('keydown', begin, { capture: true });
        document.removeEventListener('keydown', end);
        document.removeEventListener('beforeinput', begin, { capture: true });
        document.removeEventListener('beforeinput', end);
        return {
          keydowns,
          beforeInputs,
          handlerMs,
          presentationMs,
          frameGapsMs,
          heapStart,
          heapEnd: memoryOf(),
        };
      },
    };
  });
}

async function dispatchChars(page: Page, count: number, char = 'x'): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const intervalMs = 1_000 / BURST_HZ;
  const started = nodePerformance.now();
  const pending: Promise<unknown>[] = [];
  for (let index = 0; index < count; index += 1) {
    const waitMs = started + index * intervalMs - nodePerformance.now();
    if (waitMs > 0) await delay(waitMs);
    pending.push(
      client.send('Input.dispatchKeyEvent', {
        type: 'char',
        key: char,
        text: char,
        unmodifiedText: char,
      })
    );
  }
  await Promise.all(pending);
  await client.detach();
}

async function dispatchBackspace(page: Page, count: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const intervalMs = 1_000 / BURST_HZ;
  const started = nodePerformance.now();
  const pending: Promise<unknown>[] = [];
  for (let index = 0; index < count; index += 1) {
    const waitMs = started + index * intervalMs - nodePerformance.now();
    if (waitMs > 0) await delay(waitMs);
    pending.push(
      client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 51,
        autoRepeat: index > 0,
      })
    );
  }
  await Promise.all(pending);
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Backspace',
    code: 'Backspace',
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 51,
  });
  await client.detach();
}

async function collectRow(
  page: Page,
  gesture: string,
  requested: number,
  run: () => Promise<void>
): Promise<GestureRow> {
  await installProbe(page);
  await run();
  await delay(120);
  const probe = await page.evaluate(() => window.__COLLAB_PERF__!.stop());
  const processed =
    gesture.includes('backspace') || gesture.includes('bold')
      ? probe.keydowns
      : probe.beforeInputs;
  return {
    gesture,
    requested,
    processed,
    handler: summarize(probe.handlerMs),
    presentation: summarize(probe.presentationMs),
    maxFrameGapMs: probe.frameGapsMs.length > 0 ? Math.max(...probe.frameGapsMs) : 0,
    heapDeltaBytes:
      probe.heapStart !== null && probe.heapEnd !== null
        ? probe.heapEnd - probe.heapStart
        : null,
  };
}

async function focusEnd(page: Page, locator: Locator): Promise<void> {
  await locator.click();
  await page.keyboard.press('End');
}

async function selectThreeParagraphs(page: Page, locator: Locator): Promise<void> {
  await locator.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
}

async function measureMode(page: Page, prefix: string): Promise<GestureRow[]> {
  const rows: GestureRow[] = [];
  const typingTarget = await firstTextParagraph(page);
  await focusEnd(page, typingTarget);
  rows.push(
    await collectRow(page, `${prefix}:fast-type`, TYPE_EVENTS, () =>
      dispatchChars(page, TYPE_EVENTS)
    )
  );

  await focusEnd(page, await firstTextParagraph(page));
  rows.push(
    await collectRow(page, `${prefix}:backspace`, BACKSPACE_EVENTS, () =>
      dispatchBackspace(page, BACKSPACE_EVENTS)
    )
  );

  await selectThreeParagraphs(page, await firstTextParagraph(page));
  rows.push(
    await collectRow(page, `${prefix}:typeover-selection`, TYPEOVER_EVENTS, () =>
      dispatchChars(page, TYPEOVER_EVENTS)
    )
  );

  const unbolded = await firstUnboldedParagraph(page);
  await selectThreeParagraphs(page, unbolded);
  rows.push(
    await collectRow(page, `${prefix}:bold-toggle`, BOLD_TOGGLES, async () => {
      for (let index = 0; index < BOLD_TOGGLES; index += 1) {
        await page.keyboard.press('ControlOrMeta+b');
        await delay(40);
      }
    })
  );

  const cell = await firstTableCellParagraph(page);
  await cell.click();
  await page.keyboard.press('End');
  rows.push(
    await collectRow(page, `${prefix}:table-cell-type`, TYPE_EVENTS, () =>
      dispatchChars(page, TYPE_EVENTS)
    )
  );
  return rows;
}

function presentationBudget(row: GestureRow): 'pass' | 'fail' {
  if (row.presentation.medianMs <= ELIGIBLE_MEDIAN_MS && row.presentation.p95Ms <= ELIGIBLE_P95_MS) {
    return 'pass';
  }
  return 'fail';
}

function ratioBudget(solo: GestureRow, attached: GestureRow): 'pass' | 'fail' {
  const slack = 4;
  if (
    attached.presentation.medianMs <= Math.max(solo.presentation.medianMs * RATIO, solo.presentation.medianMs + slack) &&
    attached.presentation.p95Ms <= Math.max(solo.presentation.p95Ms * RATIO, solo.presentation.p95Ms + slack) &&
    attached.handler.p95Ms <= Math.max(solo.handler.p95Ms * RATIO, solo.handler.p95Ms + slack)
  ) {
    return 'pass';
  }
  return 'fail';
}

test('local typing with a replica stays within collaboration budgets', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await waitForEditor(page);
  const solo = await measureMode(page, 'solo');

  const invite = await createRoom(page, 'Alice');
  await expectParticipantCount(page, 1);
  const attached = await measureMode(page, 'attached');

  const remoteContext = await browser.newContext();
  const joiner = await remoteContext.newPage();
  await joinRoom(joiner, invite, 'Bob');
  await expectParticipantCount(page, 2);
  await expectParticipantCount(joiner, 2);

  const bobParagraph = await firstTextParagraph(joiner);
  await bobParagraph.click();
  await joiner.keyboard.press('End');
  const bobTyping = (async () => {
    for (let index = 0; index < TYPE_EVENTS; index += 1) {
      await joiner.keyboard.type('b', { delay: 20 });
    }
  })();
  const aliceTarget = await firstTextParagraph(page);
  await focusEnd(page, aliceTarget);
  const peerRow = await collectRow(page, 'peer-editing:fast-type', TYPE_EVENTS, () =>
    dispatchChars(page, TYPE_EVENTS)
  );
  await bobTyping;

  const leakBefore = await page.evaluate(() => {
    const memory = (
      performance as Performance & { memory?: { readonly usedJSHeapSize: number } }
    ).memory;
    return memory?.usedJSHeapSize ?? null;
  });
  await focusEnd(page, await firstTextParagraph(page));
  await dispatchChars(page, 200, 'z');
  await delay(500);
  const leakAfter = await page.evaluate(() => {
    const memory = (
      performance as Performance & { memory?: { readonly usedJSHeapSize: number } }
    ).memory;
    return memory?.usedJSHeapSize ?? null;
  });

  const report = {
    eligibleMedianMs: ELIGIBLE_MEDIAN_MS,
    eligibleP95Ms: ELIGIBLE_P95_MS,
    ratio: RATIO,
    solo,
    attached,
    peerEditing: peerRow,
    heapDeltaBytes:
      leakBefore !== null && leakAfter !== null ? leakAfter - leakBefore : null,
  };
  // The line reporter keeps this JSON for the measurement write-up.
  console.log(`COLLAB_PERF_REPORT ${JSON.stringify(report)}`);

  for (const row of attached) {
    const name = row.gesture.replace('attached:', '');
    const soloRow = solo.find((entry) => entry.gesture.endsWith(name));
    expect(soloRow, row.gesture).toBeTruthy();
    expect(ratioBudget(soloRow!, row), `${row.gesture} vs solo`).toBe('pass');
  }
  expect(ratioBudget(solo[0]!, peerRow), 'peer-editing vs solo type').toBe('pass');
  for (const row of [...attached, peerRow]) {
    expect(row.processed, row.gesture).toBeGreaterThan(row.requested * 0.5);
  }
});
