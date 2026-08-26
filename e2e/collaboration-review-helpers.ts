import { expect, type Locator, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

export interface ReviewWriteItemSnap {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly author: string;
  readonly resolved: boolean;
  readonly parentId: string | null;
  readonly revisionKind: string | null;
}

export const COLLAB_E2E_PORT = Number(process.env.COLLAB_E2E_PORT ?? 5276);
export const ORIGIN = `http://localhost:${COLLAB_E2E_PORT}`;
const CONNECT = /^Connect$/;
const SCROLLER = '.docx-editor__scroll-container';

/**
 * Pages past the first sheet are virtualized. A programmatic scrollTop change does not
 * rebuild them unless the scroller also sees a wheel, so a locator for a later table
 * would stay empty forever.
 */
export async function nudgeScroller(page: Page): Promise<void> {
  await page
    .locator(SCROLLER)
    .first()
    .evaluate((element) => {
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    });
}

/**
 * Walk the scroller until `locator` paints. The demo's first table sits after the TOC,
 * so a first-page-only query never sees a cell.
 */
export async function revealLocator(page: Page, locator: Locator): Promise<Locator> {
  const scroller = page.locator(SCROLLER).first();
  await expect(scroller).toBeVisible();
  for (let step = 0; step < 80; step += 1) {
    try {
      await expect(locator.first()).toBeVisible({ timeout: 750 });
      await locator.first().scrollIntoViewIfNeeded();
      await nudgeScroller(page);
      await expect(locator.first()).toBeVisible({ timeout: 5_000 });
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

export async function waitForEditor(page: Page, url = ORIGIN): Promise<void> {
  await page.goto(url, { waitUntil: 'commit' });
  await expect(page.getByRole('button', { name: CONNECT })).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('[data-paragraph-id]:visible').first()).toBeVisible({
    timeout: 180_000,
  });
}

export async function createRoom(page: Page, name: string): Promise<string> {
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

export async function joinRoom(page: Page, invite: string, name: string): Promise<void> {
  await waitForEditor(page, invite);
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 45_000 });
}

export async function expectParticipantCount(
  page: Page,
  count: number,
  timeout = 20_000
): Promise<void> {
  await expect(page.getByRole('button', { name: `${count} online` })).toBeVisible({ timeout });
}

/**
 * Two connected peers on one room, so every test streams real document changes.
 *
 * The joiner runs in a separate browser context on purpose. Two pages in one
 * context share a `BroadcastChannel`, and `y-webrtc` prefers it over a data
 * channel, so a same-context pair syncs without ever touching WebRTC.
 */
export async function connectedPeers(
  browser: import('@playwright/test').Browser,
  creator: Page,
  fixture?: string
): Promise<Page> {
  await waitForEditor(creator, fixture ? `${ORIGIN}/?fixture=${fixture}` : ORIGIN);
  const invite = await createRoom(creator, 'Alice');
  const remoteContext = await browser.newContext();
  const joiner = await remoteContext.newPage();
  await joinRoom(joiner, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(joiner, 2);
  return joiner;
}

export function paragraphs(page: Page): Locator {
  return page.locator('[data-paragraph-id]:visible');
}

export function paragraphById(page: Page, id: string): Locator {
  return page.locator(`[data-paragraph-id="${id}"]:visible`).first();
}

export async function firstTextParagraph(page: Page): Promise<{
  readonly locator: Locator;
  readonly id: string;
  readonly text: string;
}> {
  const locator = paragraphs(page).filter({ hasText: /\S/ }).first();
  await expect(locator).toBeVisible();
  return {
    locator,
    id: (await locator.getAttribute('data-paragraph-id'))!,
    text: (await locator.textContent())!,
  };
}

export function paintedHeader(page: Page): Locator {
  return page.locator('[data-docx-hf="header"][data-docx-r-id]').first();
}

export async function firstTableCellParagraph(page: Page): Promise<{
  readonly locator: Locator;
  readonly id: string;
  readonly text: string;
}> {
  const locator = await revealLocator(
    page,
    page
      .locator(
        '.docx-table-cell:not([data-v-merge-continue]) .docx-paragraph-fragment[data-paragraph-id]'
      )
      .filter({ hasText: /\S/ })
  );
  return {
    locator,
    id: (await locator.getAttribute('data-paragraph-id'))!,
    text: (await locator.textContent())!,
  };
}

export async function ensureReviewPaneOpen(page: Page): Promise<void> {
  const rail = page.locator('[data-testid="review-rail"]');
  await expect(rail).toBeVisible({ timeout: 20_000 });
  if (await rail.evaluate((node) => node.hasAttribute('data-open'))) return;
  const toggle = page.locator('.docx-toolbar [data-slot="review.comments"]').first();
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toHaveAttribute('data-disabled', '');
  await toggle.click();
  await expect(rail).toHaveAttribute('data-open', '');
}

export async function selectWholeParagraph(page: Page, locator: Locator): Promise<void> {
  await locator.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

/**
 * Add a comment through the painted affordance, not `editor.addComment`.
 * A range without that button would mean the demo never offered the write.
 */
export async function addCommentThroughUi(
  page: Page,
  locator: Locator,
  body: string
): Promise<void> {
  await ensureReviewPaneOpen(page);
  await selectWholeParagraph(page, locator);
  const add = page.locator('[data-testid="review-add-comment"]');
  await expect(add).toBeVisible({ timeout: 10_000 });
  await add.click();
  const input = page.locator('[data-testid="review-draft-input"]');
  await expect(input).toBeVisible();
  await input.fill(body);
  await page.locator('[data-testid="review-draft-submit"]').click();
  await expect(page.locator('[data-testid="review-draft"]')).toHaveCount(0);
}

export function commentCard(page: Page, body: string): Locator {
  return page.locator('[data-testid="review-card"][data-kind="comment"]').filter({ hasText: body });
}

export async function reviewItems(page: Page): Promise<ReviewWriteItemSnap[]> {
  return page.evaluate(() => {
    const hook = window.__DOCX_REVIEW_E2E__;
    if (!hook) throw new Error('review e2e bridge missing');
    return hook.reviewItems();
  });
}

export async function savePackageBytes(page: Page): Promise<Uint8Array> {
  const numbers = await page.evaluate(async () => {
    const hook = window.__DOCX_REVIEW_E2E__;
    if (!hook) throw new Error('review e2e bridge missing');
    return hook.saveBytes();
  });
  return Uint8Array.from(numbers);
}

export async function setEditingMode(
  page: Page,
  mode: 'editing' | 'suggesting' | 'viewing'
): Promise<void> {
  const trigger = page.getByTestId('editing-mode-trigger');
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('data-mode')) === mode) return;
  await trigger.click();
  await page.getByTestId(`editing-mode-${mode}`).click();
  await expect(trigger).toHaveAttribute('data-mode', mode);
}

export function revisionCard(page: Page, kind: 'insert' | 'delete', text: string): Locator {
  return page.locator(`[data-testid="review-card"][data-kind="${kind}"]`).filter({ hasText: text });
}

export interface SavedComment {
  readonly id: string;
  readonly author: string;
  readonly text: string;
}

/** Comments part records. A peer that kept a `commentReference` without this row is corrupt. */
export function commentsFromPackage(bytes: Uint8Array): SavedComment[] {
  const files = unzipSync(bytes);
  const xml = strFromU8(files['word/comments.xml'] ?? new Uint8Array());
  return [...xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)].map((match) => ({
    id: /w:id="(\d+)"/.exec(match[1] ?? '')?.[1] ?? '',
    author: /w:author="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '',
    text: [...(match[2] ?? '').matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
      .map((run) => run[1] ?? '')
      .join(''),
  }));
}

export function documentXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  return strFromU8(files['word/document.xml'] ?? new Uint8Array());
}

export function headerXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((key) => /word\/header\d+\.xml$/.test(key));
  return name ? strFromU8(files[name]!) : '';
}

/** True when the saved body still carries `w:delText` for `needle`. */
export function hasDelText(xml: string, needle: string): boolean {
  return [...xml.matchAll(/<w:delText\b[^>]*>([^<]*)<\/w:delText>/g)].some((match) =>
    (match[1] ?? '').includes(needle)
  );
}

export function tocEntriesFromDocument(xml: string): { text: string; page: string }[] {
  const blocks = xml.split(/<w:p[\s>]/);
  const entries: { text: string; page: string }[] = [];
  for (const block of blocks) {
    if (!/w:val="TOC\d+"/.test(block) && !/PAGEREF _Toc/.test(block)) continue;
    const runs = [...block.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1] ?? '');
    const text = runs.join('').trim();
    if (!text) continue;
    const page = /\d+$/.exec(text)?.[0] ?? '';
    entries.push({ text, page });
  }
  return entries;
}
