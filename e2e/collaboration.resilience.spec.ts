import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PORT = process.env.COLLAB_E2E_PORT ?? '5276';
const ORIGIN = `http://localhost:${PORT}`;
const CONNECT = /^Connect$/;
const OUT_OF_SYNC = 'Out of sync. Reload to rejoin.';
const SCROLLER = '.docx-editor__scroll-container';

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

async function joinRoom(page: Page, invite: string, name: string): Promise<void> {
  await waitForEditor(page, invite);
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 45_000 });
}

async function expectParticipantCount(page: Page, count: number, timeout = 20_000): Promise<void> {
  await expect(page.getByRole('button', { name: `${count} online` })).toBeVisible({ timeout });
}

function paragraphs(page: Page): Locator {
  return page.locator('[data-paragraph-id]:visible');
}

function paragraphFragments(page: Page): Locator {
  return page.locator('.docx-page-content .docx-paragraph-fragment[data-paragraph-id]:visible');
}

function paragraphById(page: Page, id: string): Locator {
  return page.locator(`[data-paragraph-id="${id}"]:visible`).first();
}

/** Heaviest painted font weight inside one paragraph, so bold headings are skipped. */
async function maxFontWeight(paragraph: Locator): Promise<number> {
  return paragraph.evaluate((element) => {
    let heaviest = 0;
    const nodes = [element, ...Array.from(element.querySelectorAll('*'))];
    for (const node of nodes) {
      const weight = Number.parseInt(getComputedStyle(node as Element).fontWeight, 10);
      if (Number.isFinite(weight) && weight > heaviest) heaviest = weight;
    }
    return heaviest;
  });
}

/**
 * All painted fragments of one paragraph, joined. The title wraps after a few
 * typed characters, and a `.first()` locator then sees only the first line, so
 * a later `toHaveText` looks like a lost character when the rest sat on line 2.
 */
async function joinedParagraphText(page: Page, id: string): Promise<string> {
  return page.evaluate((paragraphId) => {
    const nodes = [
      ...document.querySelectorAll('.docx-page-content .docx-paragraph-fragment[data-paragraph-id]'),
    ].filter(
      (node) =>
        node.getAttribute('data-paragraph-id') === paragraphId && !node.closest('[data-docx-hf]')
    );
    return nodes.map((node) => node.textContent ?? '').join('');
  }, id);
}

async function expectJoinedText(
  page: Page,
  id: string,
  expected: string,
  timeout = 20_000
): Promise<void> {
  await expect(async () => {
    expect(await joinedParagraphText(page, id)).toBe(expected);
  }).toPass({ timeout });
}

async function twoUnboldedBodyParagraphs(page: Page): Promise<{
  readonly firstId: string;
  readonly secondId: string;
  readonly firstText: string;
  readonly secondText: string;
}> {
  const all = paragraphFragments(page).filter({ hasText: /\S/ });
  await expect(all.first()).toBeVisible();
  const limit = Math.min(await all.count(), 40);
  const picked: { id: string; text: string }[] = [];
  for (let index = 0; index < limit; index += 1) {
    const locator = all.nth(index);
    const id = (await locator.getAttribute('data-paragraph-id'))!;
    if (picked.some((entry) => entry.id === id)) continue;
    if ((await maxFontWeight(locator)) >= 600) continue;
    const text = await joinedParagraphText(page, id);
    if (text.trim().length < 4) continue;
    picked.push({ id, text });
    if (picked.length === 2) {
      return {
        firstId: picked[0]!.id,
        secondId: picked[1]!.id,
        firstText: picked[0]!.text,
        secondText: picked[1]!.text,
      };
    }
  }
  throw new Error('need two unbolded body paragraphs');
}

/**
 * Two connected peers on one room, so every test streams real document changes.
 *
 * The joiner runs in a separate browser context on purpose. Two pages in one
 * context share a `BroadcastChannel`, and `y-webrtc` prefers it over a data
 * channel, so a same-context pair syncs without ever touching WebRTC.
 */
async function connectedPeers(
  browser: Browser,
  creator: Page
): Promise<{ readonly peer: Peer; readonly invite: string }> {
  await waitForEditor(creator);
  const invite = await createRoom(creator, 'Alice');
  const remote = await openPeer(browser, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(remote.page, 2);
  return { peer: remote, invite };
}

async function openPeer(browser: Browser, invite: string, name: string): Promise<Peer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await joinRoom(page, invite, name);
  return { page, context };
}

async function disposePeer(peer: Peer): Promise<void> {
  await peer.page.close().catch(() => undefined);
  await peer.context.close().catch(() => undefined);
}

async function typeAtEnd(page: Page, paragraphId: string, text: string): Promise<void> {
  const before = await joinedParagraphText(page, paragraphId);
  const target = paragraphById(page, paragraphId);
  await target.click();
  await page.keyboard.press('End');
  // A zero-delay burst drops characters in this surface. A short delay is still
  // one run of typing, not a pause between peers.
  await page.keyboard.type(text, { delay: 20 });
  await expectJoinedText(page, paragraphId, `${before}${text}`);
}

async function openRoomDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /\d+ online/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Collaboration room' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Session `error` / `destroyed` paint this string. Waiting never repairs it: the
 * replica refused a remote update and kept the copy it already had. Treat that as
 * a failed test, not a reconnect.
 */
async function expectNoOutOfSync(page: Page): Promise<void> {
  await expect(page.getByText(OUT_OF_SYNC)).toHaveCount(0);
  const trigger = page.getByRole('button', { name: /\d+ online/ });
  if ((await trigger.count()) === 0) return;
  const dialog = await openRoomDialog(page);
  await expect(dialog.getByText(OUT_OF_SYNC)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectHealthySession(page: Page): Promise<void> {
  const dialog = await openRoomDialog(page);
  await expect(dialog.getByText(OUT_OF_SYNC)).toHaveCount(0);
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
}

async function leaveRoom(page: Page): Promise<void> {
  const dialog = await openRoomDialog(page);
  await dialog.getByRole('button', { name: 'Leave room' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: CONNECT })).toBeVisible();
}

async function firstPageFingerprint(page: Page): Promise<string> {
  await page.locator(SCROLLER).first().evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
  });
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
      rows.push(`${id}:${node.textContent ?? ''}`);
    }
    return rows.join('\n');
  });
}

async function expectFingerprintsMatch(left: Page, right: Page, timeout = 30_000): Promise<void> {
  await expect(async () => {
    expect(await firstPageFingerprint(left)).toBe(await firstPageFingerprint(right));
  }).toPass({ timeout });
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

async function saveDocx(page: Page): Promise<{ readonly path: string; readonly xml: string }> {
  // Click a painted paragraph first so Ctrl+S is inside the editor root. A
  // document-level shortcut that fires from the collaboration chrome would
  // miss the menu listener and produce no download.
  await paragraphs(page).first().click();
  const downloadPromise = page.waitForEvent('download', { timeout: 25_000 });
  const fileMenu = page.getByRole('menubar').getByRole('menuitem', { name: 'File' });
  if (await fileMenu.isVisible()) {
    await fileMenu.click();
    await page.getByRole('menuitem', { name: /^Save/ }).click();
  } else {
    await page.keyboard.press('ControlOrMeta+s');
  }
  const download = await downloadPromise;
  const filePath = await download.path();
  if (!filePath) throw new Error('save produced no file');
  const xml = execFileSync('unzip', ['-p', filePath, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return { path: filePath, xml };
}

function xmlPlainText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) => match[1] ?? '')
    .join('');
}

test('a third peer joining mid-session receives the current document', async ({
  browser,
  page: creator,
}) => {
  const { peer: bob, invite } = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [A-before]');
  await typeAtEnd(bob.page, secondId, ' [B-before]');
  const expectedFirst = `${firstText} [A-before]`;
  const expectedSecond = `${secondText} [B-before]`;
  for (const peer of [creator, bob.page]) {
    await expectJoinedText(peer, firstId, expectedFirst);
    await expectJoinedText(peer, secondId, expectedSecond);
  }

  const carol = await openPeer(browser, invite, 'Carol');
  await expectParticipantCount(creator, 3, 45_000);
  await expectParticipantCount(carol.page, 3, 45_000);
  await expectJoinedText(carol.page, firstId, expectedFirst, 30_000);
  await expectJoinedText(carol.page, secondId, expectedSecond, 30_000);
  await expectFingerprintsMatch(creator, carol.page);

  await typeAtEnd(creator, firstId, ' [A-after]');
  const afterFirst = `${expectedFirst} [A-after]`;
  for (const peer of [creator, bob.page, carol.page]) {
    await expectJoinedText(peer, firstId, afterFirst);
    await expectJoinedText(peer, secondId, expectedSecond);
  }
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await expectHealthySession(carol.page);
  await disposePeer(carol);
  await disposePeer(bob);
});

test('a peer that leaves and rejoins receives later edits', async ({ browser, page: creator }) => {
  const { peer: bob, invite } = await connectedPeers(browser, creator);
  const { firstId, firstText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [before-leave]');
  await expectJoinedText(bob.page, firstId, `${firstText} [before-leave]`);

  await leaveRoom(bob.page);
  await expectParticipantCount(creator, 1, 45_000);
  await typeAtEnd(creator, firstId, ' [after-leave]');
  const expected = `${firstText} [before-leave] [after-leave]`;
  await expectJoinedText(creator, firstId, expected);

  await joinRoom(bob.page, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(bob.page, 2);
  await expectJoinedText(bob.page, firstId, expected, 30_000);
  expect(await joinedParagraphText(bob.page, firstId)).not.toBe(`${firstText} [before-leave]`);
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});

test('a reloaded peer rejoins with the newer document', async ({ browser, page: creator }) => {
  const { peer: bob, invite } = await connectedPeers(browser, creator);
  const { firstId, firstText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [before-reload]');
  await expectJoinedText(bob.page, firstId, `${firstText} [before-reload]`);

  const reloading = bob.page.reload({ waitUntil: 'commit' });
  await typeAtEnd(creator, firstId, ' [during-reload]');
  await reloading;
  const expected = `${firstText} [before-reload] [during-reload]`;
  await expectJoinedText(creator, firstId, expected);

  await joinRoom(bob.page, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(bob.page, 2);
  await expectJoinedText(bob.page, firstId, expected, 30_000);
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});

test('the last peer keeps an editable document after the host closes', async ({
  browser,
  page: creator,
}) => {
  const { peer: bob } = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [A-host]');
  await typeAtEnd(bob.page, secondId, ' [B-stay]');
  const expectedFirst = `${firstText} [A-host]`;
  const expectedSecond = `${secondText} [B-stay]`;
  await expectJoinedText(bob.page, firstId, expectedFirst);
  await expectJoinedText(bob.page, secondId, expectedSecond);

  await creator.close();
  await expectJoinedText(bob.page, firstId, expectedFirst);
  await expectJoinedText(bob.page, secondId, expectedSecond);
  await typeAtEnd(bob.page, firstId, ' [solo]');
  const solo = `${expectedFirst} [solo]`;
  await expectJoinedText(bob.page, firstId, solo);
  const saved = await saveDocx(bob.page);
  const savedText = xmlPlainText(saved.xml);
  expect(savedText).toContain('[A-host]');
  expect(savedText).toContain('[B-stay]');
  expect(savedText).toContain('[solo]');
  await expectNoOutOfSync(bob.page);
  await disposePeer(bob);
});

test('simultaneous edits to the same paragraph converge without loss or duplication', async ({
  browser,
  page: creator,
}) => {
  const { peer: bob } = await connectedPeers(browser, creator);
  const { firstId, firstText } = await twoUnboldedBodyParagraphs(creator);
  await paragraphById(creator, firstId).click();
  await creator.keyboard.press('End');
  await paragraphById(bob.page, firstId).click();
  await bob.page.keyboard.press('End');

  // Tokens are unique and do not appear in the fixture. A merge bug once
  // pasted selected text inside itself; that shows up as the original line
  // occurring twice, or a token occurring twice.
  const aMarks = ['[A1]', '[A2]', '[A3]', '[A4]', '[A5]'];
  const bMarks = ['[B1]', '[B2]', '[B3]', '[B4]', '[B5]'];
  for (let round = 0; round < aMarks.length; round += 1) {
    await Promise.all([
      creator.keyboard.type(aMarks[round]!, { delay: 0 }),
      bob.page.keyboard.type(bMarks[round]!, { delay: 0 }),
    ]);
  }

  await expect(async () => {
    const local = await joinedParagraphText(creator, firstId);
    const remote = await joinedParagraphText(bob.page, firstId);
    expect(local).toBe(remote);
    expect(countOccurrences(local, firstText)).toBe(1);
    for (const mark of [...aMarks, ...bMarks]) {
      expect(countOccurrences(local, mark)).toBe(1);
    }
  }).toPass({ timeout: 30_000 });
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});

test('a peer that goes offline and returns converges instead of staying out of sync', async ({
  browser,
  page: creator,
}) => {
  const { peer: bob } = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoUnboldedBodyParagraphs(creator);
  await bob.context.setOffline(true);
  await typeAtEnd(creator, firstId, ' [A-offline]');
  await typeAtEnd(bob.page, secondId, ' [B-offline]');
  await expectJoinedText(creator, firstId, `${firstText} [A-offline]`);
  await expectJoinedText(bob.page, secondId, `${secondText} [B-offline]`);

  await bob.context.setOffline(false);
  for (const peer of [creator, bob.page]) {
    await expectJoinedText(peer, firstId, `${firstText} [A-offline]`, 45_000);
    await expectJoinedText(peer, secondId, `${secondText} [B-offline]`, 45_000);
  }
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});

test('undo after a remote edit reverts only the local change', async ({
  browser,
  page: creator,
}) => {
  const { peer: bob } = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [A-undo]');
  await expectJoinedText(bob.page, firstId, `${firstText} [A-undo]`);
  await typeAtEnd(bob.page, secondId, ' [B-keep]');
  await expectJoinedText(creator, secondId, `${secondText} [B-keep]`);

  await paragraphById(creator, firstId).click();
  await creator.keyboard.press('ControlOrMeta+z');
  for (const peer of [creator, bob.page]) {
    await expectJoinedText(peer, firstId, firstText);
    await expectJoinedText(peer, secondId, `${secondText} [B-keep]`);
  }
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});

test('saves from both peers after a session agree', async ({ browser, page: creator }) => {
  const { peer: bob } = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoUnboldedBodyParagraphs(creator);
  await typeAtEnd(creator, firstId, ' [A-save]');
  await typeAtEnd(bob.page, secondId, ' [B-save]');
  for (const peer of [creator, bob.page]) {
    await expectJoinedText(peer, firstId, `${firstText} [A-save]`);
    await expectJoinedText(peer, secondId, `${secondText} [B-save]`);
  }

  // Saved from each peer, then compared. Reopen is unused because both downloads
  // completed. Byte identity of the zip is not required: package metadata can
  // differ. The main-document text is the document the reviewers will reopen.
  const aliceSave = await saveDocx(creator);
  const bobSave = await saveDocx(bob.page);
  const aliceText = xmlPlainText(aliceSave.xml);
  const bobText = xmlPlainText(bobSave.xml);
  expect(aliceText).toContain('[A-save]');
  expect(aliceText).toContain('[B-save]');
  expect(bobText).toBe(aliceText);
  await expectHealthySession(creator);
  await expectHealthySession(bob.page);
  await disposePeer(bob);
});
