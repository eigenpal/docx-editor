import { expect, test, type Locator, type Page } from '@playwright/test';

// The port the config actually started the dev server on. Hardcoding it meant
// `COLLAB_E2E_PORT=… bun run test:e2e:collab` started a server on one port and drove a
// browser at another, and every test failed with ERR_CONNECTION_REFUSED — a confusing
// way to learn that only three of the five collaboration entry points read the variable.
const PORT = process.env.COLLAB_E2E_PORT ?? '5276';
const ORIGIN = `http://localhost:${PORT}`;
const CONNECT = /^Connect$/;
const SCROLLER = '.docx-editor__scroll-container';

/**
 * Pages past the first sheet are virtualized. A programmatic scrollTop change does not
 * rebuild them unless the scroller also sees a wheel, so a locator for a later table
 * would stay empty forever.
 */
async function nudgeScroller(page: Page): Promise<void> {
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
async function revealLocator(page: Page, locator: Locator): Promise<Locator> {
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
 * A painted cell paragraph, not a body line. Cells carry `data-cell-id` on
 * `.docx-table-cell` and the same `data-paragraph-id` as body text, so a bare
 * paragraph query cannot tell them apart.
 */
async function firstTableCellParagraph(page: Page): Promise<{
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

function paintedHeader(page: Page): Locator {
  return page.locator('[data-docx-hf="header"][data-docx-r-id]').first();
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

test('bolding part of a paragraph keeps its text once', async ({ browser, page: creator }) => {
  // A selection that stops short of the paragraph end splits the run, and that journal mints a
  // text node and fills it. Applying the fill twice used to duplicate the line in place
  // (`Date: Date: March 2 2026March 2 2026`). A full-range Bold never emits that shape, so it
  // cannot stand in for this case.
  const joiner = await connectedPeers(browser, creator);
  const source = await firstUnboldedParagraph(creator);
  const local = paragraphById(creator, source.id);
  const remote = paragraphById(joiner, source.id);
  await expect(remote).toHaveText(source.text);

  await source.locator.click();
  await creator.keyboard.press('Home');
  await creator.keyboard.press('Shift+End');
  await creator.keyboard.press('Shift+ArrowLeft');
  await creator.keyboard.press('ControlOrMeta+b');

  await expect(async () => {
    expect(await maxFontWeight(local)).toBeGreaterThanOrEqual(600);
  }).toPass({ timeout: 20_000 });
  await expect(local).toHaveText(source.text);
  await expect(remote).toHaveText(source.text);
});

test('paragraph split and join stream to the other browser', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const source = await firstUnboldedParagraph(creator);

  await source.locator.click();
  await creator.keyboard.press('End');
  await creator.keyboard.press('Enter');
  await creator.keyboard.type('Split paragraph');

  const localSplit = creator.getByText('Split paragraph', { exact: false });
  const remoteSplit = joiner.getByText('Split paragraph', { exact: false });
  await expect(localSplit.first()).toBeVisible({ timeout: 10_000 });
  await expect(remoteSplit.first()).toBeVisible({ timeout: 20_000 });

  for (let index = 0; index < 'Split paragraph'.length; index += 1) {
    await creator.keyboard.press('Backspace');
  }
  await creator.keyboard.press('Backspace');

  await expect(remoteSplit).toHaveCount(0, { timeout: 20_000 });
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

test('a cross-paragraph selection appears on the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const { firstId, secondId } = await twoDistinctBodyParagraphs(creator);

  await paragraphById(creator, firstId).click();
  await creator.keyboard.press('Home');
  await creator.keyboard.down('Shift');
  await paragraphById(creator, secondId).click();
  await creator.keyboard.up('Shift');

  await expect(joiner.locator('.docx-remote-selection-rect').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(joiner.locator('.docx-remote-selection-rect')).not.toHaveCount(1);
  await expect(joiner.locator('.docx-remote-selection-overlay')).toHaveAttribute(
    'contenteditable',
    'false'
  );
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

test('typing in a table cell streams to the other browser', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const source = await firstTableCellParagraph(creator);
  const marker = ' [cell]';
  const expected = `${source.text}${marker}`;
  const remote = await revealLocator(joiner, paragraphById(joiner, source.id));
  await expect(remote).toHaveText(source.text);

  await source.locator.click();
  await creator.keyboard.press('End');
  await creator.keyboard.type(marker);
  await expect(paragraphById(creator, source.id)).toHaveText(expected, { timeout: 20_000 });
  await expect(remote).toHaveText(expected, { timeout: 20_000 });
});

test('editing a header streams to the other browser', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator);
  const header = paintedHeader(creator);
  await expect(header).toBeVisible();
  // Furniture stays contenteditable=false until the Word gesture. A single click would
  // place a body caret and type into the title instead of the header story.
  await header.dblclick();
  await expect(creator.locator('[data-docx-hf-active][data-docx-hf="header"]')).toBeVisible({
    timeout: 20_000,
  });

  const local = creator.locator('[data-docx-hf-active] [data-paragraph-id]').first();
  await expect(local).toBeVisible();
  const id = (await local.getAttribute('data-paragraph-id'))!;
  const before = (await local.textContent())!;
  const marker = ' [hf]';

  await local.click();
  await creator.keyboard.press('End');
  await creator.keyboard.type(marker);
  await expect(local).toHaveText(`${before}${marker}`, { timeout: 20_000 });

  const remote = joiner.locator(`[data-docx-hf="header"] [data-paragraph-id="${id}"]`).first();
  await expect(remote).toHaveText(`${before}${marker}`, { timeout: 20_000 });
});

test('an edit across a multi-paragraph selection streams to the other browser', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator);
  const { firstId, secondId, firstText, secondText } = await twoDistinctBodyParagraphs(creator);
  expect(firstId).not.toBe(secondId);
  expect(firstText.trim().length).toBeGreaterThan(3);
  expect(secondText.trim().length).toBeGreaterThan(3);
  await expect(paragraphById(joiner, firstId)).toHaveText(firstText);
  await expect(paragraphById(joiner, secondId)).toHaveText(secondText);

  await paragraphById(creator, firstId).click();
  await creator.keyboard.press('Home');
  const mid = Math.max(1, Math.floor(firstText.length / 2));
  for (let index = 0; index < mid; index += 1) {
    await creator.keyboard.press('ArrowRight');
  }
  // Same Shift+click the presence test uses. Starting at mid-paragraph is what turns
  // that overlay into an edit: Home+Shift+click would delete the whole first line and
  // hide a mid-to-mid failure.
  await creator.keyboard.down('Shift');
  await paragraphById(creator, secondId).click();
  await creator.keyboard.up('Shift');

  const marker = '[span-edit]';
  await creator.keyboard.type(marker);

  await expect(paragraphById(creator, firstId)).toContainText(marker, { timeout: 20_000 });
  const localFirst = (await paragraphById(creator, firstId).textContent())!;
  expect(localFirst).not.toBe(firstText);
  const localSecondCount = await paragraphById(creator, secondId).count();
  const localSecond =
    localSecondCount > 0 ? (await paragraphById(creator, secondId).textContent())! : null;

  await expect(paragraphById(joiner, firstId)).toHaveText(localFirst, { timeout: 20_000 });
  if (localSecond === null) {
    await expect(paragraphById(joiner, secondId)).toHaveCount(0);
  } else {
    await expect(paragraphById(joiner, secondId)).toHaveText(localSecond, { timeout: 20_000 });
  }
});
