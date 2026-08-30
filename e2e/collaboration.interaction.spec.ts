import { expect, test, type Page } from '@playwright/test';

// See the note in collaboration.fulldocument.spec.ts: the config honours this, so the
// specs it drives have to as well.
const PORT = process.env.COLLAB_E2E_PORT ?? '5276';
const ORIGIN = `http://localhost:${PORT}`;
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
  const connectedDialog = page.getByRole('dialog', { name: 'Collaboration room' });
  await expect(connectedDialog.getByText('Connected', { exact: true })).toBeVisible();
  const invite = await connectedDialog.getByLabel('Invite link').inputValue();
  // Anchored at both ends, exactly as before: only the PORT is parameterized here. This
  // assertion currently fails because the invite link gained a `#collab=` fragment in
  // #499 and the spec was never updated — a live regression on main, and not this file's
  // to decide. Relaxing the anchor here would hide it.
  expect(invite).toMatch(new RegExp(`^http://localhost:${PORT}/\\?room=[A-Za-z0-9_-]{24,256}$`));
  await connectedDialog.getByRole('button', { name: 'Done' }).click();
  await expect(connectedDialog).toHaveCount(0);
  return invite;
}

async function joinRoom(page: Page, invite: string, name: string): Promise<void> {
  await waitForEditor(page, invite);
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name').fill(name);
  await expect(dialog.getByLabel('Room ID or link')).toHaveValue(invite.match(/room=([^&]+)/)![1]!);
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog).toHaveCount(0);
}

async function firstEditableParagraph(page: Page) {
  const paragraph = page.locator('[data-paragraph-id]:visible').filter({ hasText: /\S/ }).first();
  await expect(paragraph).toBeVisible();
  return {
    paragraph,
    id: (await paragraph.getAttribute('data-paragraph-id'))!,
    text: (await paragraph.textContent())!,
  };
}

async function expectParticipantCount(page: Page, count: number, timeout = 15_000): Promise<void> {
  await expect(page.getByRole('button', { name: `${count} online` })).toBeVisible({ timeout });
}

test('share-link peers edit, paint presence, disconnect, and rejoin', async ({
  context,
  page: creator,
}) => {
  await waitForEditor(creator);
  const invite = await createRoom(creator, 'Alice');
  await expectParticipantCount(creator, 1);

  const joiner = await context.newPage();
  await joinRoom(joiner, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(joiner, 2);

  await expect(creator.getByRole('button', { name: 'New' })).toBeDisabled();
  await expect(joiner.getByRole('button', { name: 'New' })).toBeDisabled();

  const source = await firstEditableParagraph(creator);
  const remote = joiner.locator(`[data-paragraph-id="${source.id}"]:visible`).first();
  const marker = ' [A]';
  await source.paragraph.click();
  await creator.keyboard.press('End');

  const startedAt = performance.now();
  await creator.keyboard.type(marker);
  await expect(source.paragraph).toContainText(`${source.text}${marker}`);
  expect(performance.now() - startedAt).toBeLessThan(2_000);

  await expect(remote).toContainText(`${source.text}${marker}`);
  await expect(
    joiner.locator('.docx-remote-caret-label').filter({ hasText: 'Alice' })
  ).toBeVisible();

  for (let index = 0; index < marker.length; index += 1) {
    await creator.keyboard.press('Backspace');
  }
  await expect(source.paragraph).toHaveText(source.text);
  await expect(remote).toHaveText(source.text);

  await joiner.close();
  await expectParticipantCount(creator, 1, 45_000);

  const rejoined = await context.newPage();
  await joinRoom(rejoined, invite, 'Bob');
  await expectParticipantCount(creator, 2);
  await expectParticipantCount(rejoined, 2);
  await expect(rejoined.locator(`[data-paragraph-id="${source.id}"]:visible`).first()).toHaveText(
    source.text
  );
});

test('invalid and missing rooms fail without changing the document', async ({ context, page }) => {
  await waitForEditor(page);
  const before = (await firstEditableParagraph(page)).text;
  await page.getByRole('button', { name: CONNECT }).click();
  const dialog = page.getByRole('dialog', { name: /Collaborate on this document/i });
  await dialog.getByLabel('Display name').fill('Alice');
  await dialog.getByRole('button', { name: /Join an existing room/i }).click();
  await dialog.getByLabel('Room ID or link').fill('too-short');
  await dialog.getByRole('button', { name: 'Join room' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await firstEditableParagraph(page)).text).toBe(before);

  const isolated = await context.newPage();
  const missingRoom = 'a'.repeat(48);
  await waitForEditor(isolated, `${ORIGIN}/?room=${missingRoom}`);
  // A hidden page has its timers throttled, and this refusal IS a 30-second timer.
  await isolated.bringToFront();
  const joinDialog = isolated.getByRole('dialog', { name: /Collaborate on this document/i });
  await joinDialog.getByLabel('Display name').fill('No host');
  await joinDialog.getByRole('button', { name: 'Join room' }).click();
  // The room has no host, so joining refuses only when the initialization timeout expires.
  await expect(joinDialog.getByRole('alert')).toBeVisible({ timeout: 90_000 });
});
