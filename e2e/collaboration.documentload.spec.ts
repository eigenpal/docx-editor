import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  duplicateDocxBody,
  measureSharedState,
  type DuplicatedDocument,
} from './collaboration-documentload-helpers';

const PORT = process.env.COLLAB_E2E_PORT ?? '5341';
const ORIGIN = `http://localhost:${PORT}`;
const CONNECT = /^Connect$/;
const OUT_OF_SYNC_SHORT = 'Out of sync';
const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, '../examples/vite/public/sample.docx');
const SMALL = join(HERE, 'fixtures/editable-sample.docx');
const OTHER = join(HERE, 'fixtures/styled-sample.docx');

interface Peer {
  readonly page: Page;
  readonly context: BrowserContext;
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

async function joinRoomFromInvite(page: Page, name: string): Promise<number> {
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  const started = Date.now();
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  return Date.now() - started;
}

async function joinRoomByPaste(page: Page, invite: string, name: string): Promise<void> {
  await page.getByRole('button', { name: CONNECT }).click();
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await dialog.getByRole('button', { name: /Join an existing room/i }).click();
  await dialog.getByLabel('Room ID or link').fill(invite);
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 45_000 });
}

async function expectParticipantCount(page: Page, count: number, timeout = 20_000): Promise<void> {
  await expect(page.getByRole('button', { name: `${count} online` })).toBeVisible({ timeout });
}

async function openPeer(browser: Browser, invite: string, name: string): Promise<Peer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await waitForEditor(page, invite);
  await joinRoomFromInvite(page, name);
  return { page, context };
}

async function disposePeer(peer: Peer): Promise<void> {
  await peer.page.close().catch(() => undefined);
  await peer.context.close().catch(() => undefined);
}

function visibleParagraphs(page: Page): Locator {
  return page.locator(
    '.docx-page-content .docx-paragraph-fragment[data-paragraph-id]:visible'
  );
}

async function firstBodyText(page: Page): Promise<string> {
  const locator = visibleParagraphs(page).filter({ hasText: /\S/ }).first();
  await expect(locator).toBeVisible();
  return (await locator.textContent()) ?? '';
}

async function pageFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const node of document.querySelectorAll(
      '.docx-page-content .docx-paragraph-fragment[data-paragraph-id]'
    )) {
      if (node.closest('[data-docx-hf]')) continue;
      const id = node.getAttribute('data-paragraph-id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(`${id}:${(node.textContent ?? '').slice(0, 80)}`);
      if (rows.length >= 12) break;
    }
    return rows.join('\n');
  });
}

async function expectSameDocument(left: Page, right: Page, timeout = 20_000): Promise<void> {
  await expect(async () => {
    expect(await pageFingerprint(left)).toBe(await pageFingerprint(right));
  }).toPass({ timeout });
}

function collaborationTrigger(page: Page): Locator {
  return page.getByRole('button', { name: /\d+ online|Out of sync|Connect/ });
}

async function roomClaimsConnection(page: Page): Promise<boolean> {
  const label = ((await collaborationTrigger(page).textContent()) ?? '').trim();
  return /^\d+\s+online$/.test(label);
}

async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
}

/**
 * A connected room still advertises a live session while two peers paint
 * different documents. That is the failure this spec exists to catch.
 */
async function expectNoSilentDivergence(left: Page, right: Page): Promise<void> {
  const leftConnected = await roomClaimsConnection(left);
  const rightConnected = await roomClaimsConnection(right);
  if (leftConnected && rightConnected) {
    await expectSameDocument(left, right);
  }
}

test.describe.configure({ mode: 'serial' });

test('Open DOCX, New, join-with-own-file, and concurrent Open stay honest', async ({
  browser,
  page: creator,
}) => {
  await waitForEditor(creator, `${ORIGIN}/?fixture=editable-sample.docx`);
  const invite = await createRoom(creator, 'Alice');
  const remote = await openPeer(browser, invite, 'Bob');
  try {
    await expectParticipantCount(creator, 2);
    await expectParticipantCount(remote.page, 2);
    const before = await firstBodyText(creator);
    expect(before).toContain('Edit me');
    await expectSameDocument(creator, remote.page);

    await expect(creator.getByRole('button', { name: 'Open DOCX' })).toBeDisabled();
    await expect(creator.getByRole('button', { name: 'New' })).toBeDisabled();
    await expect(remote.page.getByRole('button', { name: 'Open DOCX' })).toBeDisabled();
    await expect(remote.page.getByRole('button', { name: 'New' })).toBeDisabled();

    await openFileMenu(creator);
    const fileOpen = creator.getByRole('menuitem', { name: /^Open$/ });
    await expect(fileOpen).toBeVisible();
    const openBlocked =
      (await fileOpen.getAttribute('aria-disabled')) === 'true' ||
      (await fileOpen.isDisabled());
    if (!openBlocked) {
      // The packaged File › Open still calls editor.load() while the room lives.
      // Either the new file must reach both peers, or the room must stop claiming
      // they are editing the same document.
      const menuInput = creator.locator('[data-testid="docx-menubar"] ~ input[type="file"]');
      await menuInput.setInputFiles(OTHER);
      await expect
        .poll(async () => firstBodyText(creator), { timeout: 20_000 })
        .not.toBe(before);
    }
    await creator.keyboard.press('Escape');
    await expectNoSilentDivergence(creator, remote.page);
  } finally {
    await disposePeer(remote);
  }
});

test('joining a room replaces a different local document', async ({ browser, page: creator }) => {
  await waitForEditor(creator, `${ORIGIN}/?fixture=editable-sample.docx`);
  const invite = await createRoom(creator, 'Alice');
  const aliceText = await firstBodyText(creator);

  const context = await browser.newContext();
  const joiner = await context.newPage();
  try {
    await waitForEditor(joiner, `${ORIGIN}/?fixture=styled-sample.docx`);
    const localText = await firstBodyText(joiner);
    expect(localText).not.toBe(aliceText);
    expect(localText).toContain('styles.xml');

    await joinRoomByPaste(joiner, invite, 'Bob');
    await expectParticipantCount(creator, 2);
    await expectParticipantCount(joiner, 2);
    await expect.poll(async () => firstBodyText(joiner), { timeout: 20_000 }).toBe(aliceText);
    await expectSameDocument(creator, joiner);
  } finally {
    await joiner.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
});

test('both peers cannot keep different files after concurrent Open', async ({
  browser,
  page: creator,
}) => {
  await waitForEditor(creator, `${ORIGIN}/?fixture=editable-sample.docx`);
  const invite = await createRoom(creator, 'Alice');
  const remote = await openPeer(browser, invite, 'Bob');
  try {
    await expectParticipantCount(creator, 2);
    await expectParticipantCount(remote.page, 2);

    const creatorInput = creator.locator('.demo-chrome input[type="file"]');
    const remoteInput = remote.page.locator('.demo-chrome input[type="file"]');
    await Promise.all([
      creatorInput.setInputFiles(SMALL).catch(() => undefined),
      remoteInput.setInputFiles(OTHER).catch(() => undefined),
    ]);
    await creator.waitForTimeout(2_000);
    await expectNoSilentDivergence(creator, remote.page);
  } finally {
    await disposePeer(remote);
  }
});

test('join time grows with duplicated sample.docx until it fails', async ({
  browser,
  page: creator,
}) => {
  test.setTimeout(900_000);
  const copiesList = [1, 2, 4, 8];
  const rows: string[] = [];
  rows.push('copies\tdocxBytes\tupdateBytes\tnodes\tjoinMs\tpaintMs\tresult');

  for (const copies of copiesList) {
    const document = duplicateDocxBody(SAMPLE, copies);
    const shared = measureSharedState(document.bytes);
    const result = await timeJoin(browser, creator, document);
    rows.push(
      `${copies}\t${document.fileBytes}\t${shared.updateBytes ?? ''}\t${shared.nodes ?? ''}\t${result.joinMs}\t${result.paintMs}\t${result.result}`
    );
    // eslint-disable-next-line no-console
    console.log(`[documentload] ${rows[rows.length - 1]}`);
    if (result.result !== 'ok') break;
  }

  // Printed so the run itself is the size-versus-join-time table.
  // eslint-disable-next-line no-console
  console.log(`[documentload-table]\n${rows.join('\n')}`);
  expect(rows.length).toBeGreaterThan(1);
});

async function timeJoin(
  browser: Browser,
  creator: Page,
  document: DuplicatedDocument
): Promise<{ readonly joinMs: number; readonly paintMs: number; readonly result: string }> {
  await waitForEditor(creator, `${ORIGIN}/?fixture=editable-sample.docx`);
  await expect(creator.getByRole('button', { name: 'Open DOCX' })).toBeEnabled({ timeout: 30_000 });
  await creator.locator('.demo-chrome input[type="file"]').setInputFiles({
    name: `size-${document.copies}x.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(document.bytes),
  });
  await expect(creator.getByText(document.marker).first()).toBeVisible({ timeout: 180_000 });

  let invite: string;
  try {
    invite = await createRoom(creator, 'Alice');
  } catch (cause) {
    return {
      joinMs: -1,
      paintMs: -1,
      result: `create-failed:${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const context = await browser.newContext();
  const joiner = await context.newPage();
  try {
    await waitForEditor(joiner, `${ORIGIN}/?fixture=editable-sample.docx`);
    await joiner.getByRole('button', { name: CONNECT }).click();
    const dialog = joiner.getByRole('dialog', { name: /Collaborate on this document/i });
    await dialog.getByLabel('Display name').fill('Bob');
    await dialog.getByRole('button', { name: /Join an existing room/i }).click();
    await dialog.getByLabel('Room ID or link').fill(invite);
    const joinStarted = Date.now();
    await dialog.getByRole('button', { name: 'Join room' }).click();
    try {
      await expect(dialog).toHaveCount(0, { timeout: 120_000 });
    } catch {
      const trigger = ((await collaborationTrigger(joiner).textContent()) ?? '').trim();
      return {
        joinMs: Date.now() - joinStarted,
        paintMs: -1,
        result: `join-dialog-stuck:${trigger || 'unknown'}`,
      };
    }
    const joinMs = Date.now() - joinStarted;
    const paintStarted = Date.now();
    try {
      await expect(joiner.getByText(document.marker).first()).toBeVisible({ timeout: 180_000 });
    } catch {
      const left = await firstBodyText(creator).catch(() => '');
      const right = await firstBodyText(joiner).catch(() => '');
      const connected =
        (await roomClaimsConnection(creator)) && (await roomClaimsConnection(joiner));
      return {
        joinMs,
        paintMs: Date.now() - paintStarted,
        result: connected && left !== right ? 'silently-diverge' : 'paint-timeout',
      };
    }
    return { joinMs, paintMs: Date.now() - paintStarted, result: 'ok' };
  } finally {
    await joiner.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}
