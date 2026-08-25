import { expect, test, type Locator, type Page } from '@playwright/test';

const ORIGIN = 'http://localhost:5276';
const CONNECT = /^Connect$/;

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
  await expect(connected.getByText('Connected', { exact: true })).toBeVisible();
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
  await expect(dialog).toHaveCount(0);
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

async function twoDistinctBodyParagraphs(page: Page): Promise<{
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
    picked.push({ id, text: (await locator.textContent())! });
    if (picked.length === 2) {
      return {
        firstId: picked[0]!.id,
        secondId: picked[1]!.id,
        firstText: picked[0]!.text,
        secondText: picked[1]!.text,
      };
    }
  }
  throw new Error('need two distinct body paragraphs');
}

async function firstTextParagraph(page: Page): Promise<{
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

/** Heaviest painted font weight inside one paragraph, so bold survives run splitting. */
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
 * The first painted paragraph that Bold would actually change.
 *
 * The demo document opens on its title block, and those paragraphs are already bold, so a
 * heading proves nothing about a Bold toggle streaming.
 */
async function firstUnboldedParagraph(page: Page): Promise<{
  readonly locator: Locator;
  readonly id: string;
  readonly text: string;
}> {
  const candidates = paragraphs(page).filter({ hasText: /\S/ });
  await expect(candidates.first()).toBeVisible();
  const limit = Math.min(await candidates.count(), 40);
  for (let index = 0; index < limit; index += 1) {
    const locator = candidates.nth(index);
    if ((await maxFontWeight(locator)) >= 600) continue;
    const text = (await locator.textContent())!;
    if (text.trim().length < 4) continue;
    return { locator, id: (await locator.getAttribute('data-paragraph-id'))!, text };
  }
  throw new Error('no unbolded paragraph is painted');
}

/**
 * Two connected peers on one room, so every test streams real document changes.
 *
 * The joiner runs in a separate browser context on purpose. Two pages in one
 * context share a `BroadcastChannel`, and `y-webrtc` prefers it over a data
 * channel, so a same-context pair syncs without ever touching WebRTC. Only a
 * separate context exercises the transport a real second browser uses, which is
 * where the document-sized sync has to survive the single-message ceiling.
 */
async function connectedPeers(
  browser: import('@playwright/test').Browser,
  creator: Page
): Promise<Page> {
  await waitForEditor(creator);
  const invite = await createRoom(creator, 'Alice');
  const remoteContext = await browser.newContext();
  const joiner = await remoteContext.newPage();
  await joinRoom(joiner, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(joiner, 2);
  return joiner;
}

test('character formatting streams to the other browser', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const source = await firstUnboldedParagraph(creator);
  const remote = paragraphById(joiner, source.id);
  await expect(remote).toHaveText(source.text);
  expect(await maxFontWeight(remote)).toBeLessThan(600);

  await source.locator.click();
  await creator.keyboard.press('Home');
  await creator.keyboard.press('Shift+End');
  await creator.keyboard.press('ControlOrMeta+b');

  await expect(async () => {
    expect(await maxFontWeight(source.locator)).toBeGreaterThanOrEqual(600);
  }).toPass({ timeout: 20_000 });
  await expect(async () => {
    expect(await maxFontWeight(remote)).toBeGreaterThanOrEqual(600);
  }).toPass({ timeout: 20_000 });
  await expect(remote).toHaveText(source.text);
});

test('paragraph split and join stream to the other browser', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const source = await firstTextParagraph(creator);
  const before = await paragraphs(joiner).count();

  await source.locator.click();
  await creator.keyboard.press('End');
  await creator.keyboard.press('Enter');
  await creator.keyboard.type('Split paragraph');

  await expect(paragraphs(joiner)).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(joiner.getByText('Split paragraph', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });

  for (let index = 0; index < 'Split paragraph'.length; index += 1) {
    await creator.keyboard.press('Backspace');
  }
  await creator.keyboard.press('Backspace');

  await expect(paragraphs(joiner)).toHaveCount(before, { timeout: 20_000 });
  await expect(paragraphById(joiner, source.id)).toHaveText(source.text);
});

test('undo of a remote-visible edit streams back', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const source = await firstTextParagraph(creator);
  const remote = paragraphById(joiner, source.id);

  await source.locator.click();
  await creator.keyboard.press('End');
  await creator.keyboard.type(' [undo me]');
  await expect(remote).toHaveText(`${source.text} [undo me]`, { timeout: 20_000 });

  await creator.keyboard.press('ControlOrMeta+z');
  await expect(source.locator).toHaveText(source.text, { timeout: 20_000 });
  await expect(remote).toHaveText(source.text, { timeout: 20_000 });
});

test('both peers edit different paragraphs and converge', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoDistinctBodyParagraphs(creator);
  expect(firstId).not.toBe(secondId);

  await paragraphById(creator, firstId).click();
  await creator.keyboard.press('End');
  await creator.keyboard.type(' [A]');

  await paragraphById(joiner, secondId).click();
  await joiner.keyboard.press('End');
  await joiner.keyboard.type(' [B]');

  for (const page of [creator, joiner]) {
    await expect(paragraphById(page, firstId)).toHaveText(`${firstText} [A]`, { timeout: 20_000 });
    await expect(paragraphById(page, secondId)).toHaveText(`${secondText} [B]`, {
      timeout: 20_000,
    });
  }
});
