import { expect, test } from '@playwright/test';
import {
  addCommentThroughUi,
  commentCard,
  commentsFromPackage,
  connectedPeers,
  documentXml,
  ensureReviewPaneOpen,
  firstTableCellParagraph,
  firstTextParagraph,
  hasDelText,
  headerXml,
  paintedHeader,
  paragraphById,
  revealLocator,
  reviewItems,
  revisionCard,
  savePackageBytes,
  setEditingMode,
  tocEntriesFromDocument,
} from './collaboration-review-helpers.ts';

const AUTHOR = 'Demo Reviewer';
const CLEAN = 'review-clean-demo.docx';
const EDITABLE = 'editable-sample.docx';
const HEADER = 'review-header-demo.docx';
const TABLE = 'table-cell-selection-drag.docx';
const TOC = 'paragraph-acceptance.docx';

test('adding a comment streams text and author to the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  const anchored = source.text;

  await addCommentThroughUi(creator, source.locator, 'Peer A note');

  const remote = commentCard(joiner, 'Peer A note');
  await expect(remote).toBeVisible({ timeout: 20_000 });
  await expect(remote.getByTestId('review-author')).toHaveText(AUTHOR);
  await expect(paragraphById(joiner, source.id)).toHaveText(anchored);
});

test('a reply arrives under the parent comment', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  await addCommentThroughUi(creator, source.locator, 'Parent thread');

  const local = commentCard(creator, 'Parent thread');
  await expect(local).toBeVisible({ timeout: 10_000 });
  await local.click();
  const replyInput = local.getByTestId('review-reply-input');
  await expect(replyInput).toBeVisible();
  await replyInput.fill('Reply from A');
  await local.getByTestId('review-reply-submit').click();

  const remote = commentCard(joiner, 'Parent thread');
  await expect(remote).toBeVisible({ timeout: 20_000 });
  const reply = remote.getByTestId('review-reply').filter({ hasText: 'Reply from A' });
  await expect(reply).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    const items = await reviewItems(joiner);
    const parent = items.find((item) => item.kind === 'comment' && item.text === 'Parent thread');
    const child = items.find((item) => item.kind === 'comment' && item.text === 'Reply from A');
    expect(parent).toBeTruthy();
    expect(child?.parentId).toBe(parent!.id);
  }).toPass({ timeout: 20_000 });
});

test('resolve then reopen both stream to the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  await addCommentThroughUi(creator, source.locator, 'Resolve me');

  const local = commentCard(creator, 'Resolve me');
  await expect(local).toBeVisible({ timeout: 10_000 });
  await local.getByTestId('review-resolve').click();
  await expect(local).toHaveAttribute('data-resolved', '');

  const remote = commentCard(joiner, 'Resolve me');
  await expect(remote).toHaveAttribute('data-resolved', '', { timeout: 20_000 });

  // A resolved card collapses to a disclosure. Open it or Reopen never appears.
  await remote.locator('summary').click();
  await local.locator('summary').click();
  await local.getByTestId('review-reopen').click();
  await expect(local).not.toHaveAttribute('data-resolved', '');
  await expect(remote).not.toHaveAttribute('data-resolved', '', { timeout: 20_000 });
});

test('deleting a comment keeps the anchored run text', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  const anchored = source.text;
  await addCommentThroughUi(creator, source.locator, 'Delete me');
  await expect(commentCard(joiner, 'Delete me')).toBeVisible({ timeout: 20_000 });

  const local = commentCard(creator, 'Delete me');
  await local.getByTestId('review-delete').click();
  await expect(local).toHaveCount(0);

  await expect(commentCard(joiner, 'Delete me')).toHaveCount(0, { timeout: 20_000 });
  // A comment delete that also dropped the run used to leave the peer a hole. The
  // anchored words must still be there after the marker is gone.
  await expect(paragraphById(creator, source.id)).toHaveText(anchored);
  await expect(paragraphById(joiner, source.id)).toHaveText(anchored);
});

test('accepting an insertion keeps the typed text on the peer', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  const marker = ' [ins-accept]';
  await source.locator.click();
  await setEditingMode(creator, 'suggesting');
  await creator.keyboard.press('End');
  await creator.keyboard.type(marker);

  const localCard = revisionCard(creator, 'insert', marker.trim());
  await expect(localCard).toBeVisible({ timeout: 10_000 });
  await expect(revisionCard(joiner, 'insert', marker.trim())).toBeVisible({ timeout: 20_000 });
  await localCard.getByTestId('review-accept').click();

  await expect(paragraphById(creator, source.id)).toContainText(`${source.text}${marker}`, {
    timeout: 10_000,
  });
  await expect(paragraphById(joiner, source.id)).toContainText(`${source.text}${marker}`, {
    timeout: 20_000,
  });
  await expect(revisionCard(joiner, 'insert', marker.trim())).toHaveCount(0, { timeout: 20_000 });
});

test('accepting a deletion removes the deleted text on the peer', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  expect(source.text).toContain('world');
  await source.locator.click();
  await setEditingMode(creator, 'suggesting');
  await creator.keyboard.press('End');
  for (let index = 0; index < 'world'.length; index += 1) {
    await creator.keyboard.press('Shift+ArrowLeft');
  }
  await creator.keyboard.press('Backspace');

  const localCard = revisionCard(creator, 'delete', 'world');
  await expect(localCard).toBeVisible({ timeout: 10_000 });
  await localCard.getByTestId('review-accept').click();

  await expect(paragraphById(creator, source.id)).toHaveText(/hello\s*$/i, { timeout: 10_000 });
  await expect(paragraphById(joiner, source.id)).toHaveText(/hello\s*$/i, { timeout: 20_000 });
  await expect(paragraphById(joiner, source.id)).not.toContainText('world');
});

test('rejecting an insertion removes the typed text on the peer', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  const marker = ' [ins-reject]';
  await source.locator.click();
  await setEditingMode(creator, 'suggesting');
  await creator.keyboard.press('End');
  await creator.keyboard.type(marker);

  const localCard = revisionCard(creator, 'insert', marker.trim());
  await expect(localCard).toBeVisible({ timeout: 10_000 });
  await localCard.getByTestId('review-reject').click();

  await expect(paragraphById(creator, source.id)).toHaveText(source.text, { timeout: 10_000 });
  await expect(paragraphById(joiner, source.id)).toHaveText(source.text, { timeout: 20_000 });
  await expect(paragraphById(joiner, source.id)).not.toContainText(marker.trim());
});

test('rejecting a deletion restores the text instead of leaving delText', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, CLEAN);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTextParagraph(creator);
  expect(source.text).toContain('world');
  await source.locator.click();
  await setEditingMode(creator, 'suggesting');
  await creator.keyboard.press('End');
  for (let index = 0; index < 'world'.length; index += 1) {
    await creator.keyboard.press('Shift+ArrowLeft');
  }
  await creator.keyboard.press('Backspace');

  const localCard = revisionCard(creator, 'delete', 'world');
  await expect(localCard).toBeVisible({ timeout: 10_000 });
  await localCard.getByTestId('review-reject').click();

  await expect(paragraphById(creator, source.id)).toHaveText(source.text, { timeout: 10_000 });
  await expect(paragraphById(joiner, source.id)).toHaveText(source.text, { timeout: 20_000 });
  // Rejecting a deletion used to leave `w:delText` on the peer. The painted words
  // can still look right while the saved package is wrong, so read the bytes.
  const remoteBytes = await savePackageBytes(joiner);
  expect(hasDelText(documentXml(remoteBytes), 'world')).toBe(false);
});

test('inserting and refreshing a table of contents streams entries', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, TOC);
  const heading = 'paragraph property pStyle';
  await firstTextParagraph(creator);
  await creator.getByRole('menuitem', { name: 'Insert' }).click();
  const insertToc = creator.getByRole('menuitem', { name: 'Table of contents' });
  await expect(insertToc).toBeVisible();
  await expect(insertToc).not.toHaveAttribute('aria-disabled', 'true');
  await insertToc.click();

  await expect(async () => {
    const bytes = await savePackageBytes(creator);
    expect(tocEntriesFromDocument(documentXml(bytes)).length).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  const tocParagraph = creator.locator('[data-paragraph-id]:visible').filter({ hasText: heading });
  await expect(tocParagraph.first()).toBeVisible({ timeout: 20_000 });
  await tocParagraph.first().click({ button: 'right' });
  const refresh = creator.getByRole('menuitem', { name: 'Refresh table of contents' });
  await expect(refresh).toBeVisible();
  await refresh.click();

  await expect(async () => {
    const bytes = await savePackageBytes(joiner);
    const entries = tocEntriesFromDocument(documentXml(bytes));
    expect(entries.some((entry) => entry.text.includes(heading))).toBe(true);
    expect(entries.some((entry) => entry.page.length > 0)).toBe(true);
  }).toPass({ timeout: 20_000 });
  await expect(
    joiner.locator('[data-paragraph-id]:visible').filter({ hasText: heading })
  ).toContainText(/\d/, { timeout: 20_000 });
});

test('a comment in a header streams to the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, HEADER);
  await ensureReviewPaneOpen(joiner);
  const header = paintedHeader(creator);
  await expect(header).toBeVisible();
  // Furniture stays contenteditable=false until the Word gesture. A single click would
  // place a body caret and comment the body story instead of the header store.
  await header.dblclick();
  await expect(creator.locator('[data-docx-hf-active][data-docx-hf="header"]')).toBeVisible({
    timeout: 20_000,
  });
  const local = creator.locator('[data-docx-hf-active] [data-paragraph-id]').first();
  await expect(local).toBeVisible();
  const id = (await local.getAttribute('data-paragraph-id'))!;
  const before = (await local.textContent())!;
  expect(before.trim().length).toBeGreaterThan(0);

  await addCommentThroughUi(creator, local, 'Header note');

  const remoteCard = commentCard(joiner, 'Header note');
  await expect(remoteCard).toBeVisible({ timeout: 20_000 });
  await expect(remoteCard.getByTestId('review-author')).toHaveText(AUTHOR);
  const remote = joiner.locator(`[data-docx-hf="header"] [data-paragraph-id="${id}"]`).first();
  await expect(remote).toHaveText(before);
  const remoteBytes = await savePackageBytes(joiner);
  expect(headerXml(remoteBytes)).toMatch(/w:commentRangeStart|w:commentReference/);
});

test('a comment in a table cell streams to the peer', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, TABLE);
  await ensureReviewPaneOpen(joiner);
  const source = await firstTableCellParagraph(creator);
  const anchored = source.text;

  await addCommentThroughUi(creator, source.locator, 'Cell note');

  const remoteCard = commentCard(joiner, 'Cell note');
  await expect(remoteCard).toBeVisible({ timeout: 20_000 });
  await expect(remoteCard.getByTestId('review-author')).toHaveText(AUTHOR);
  const remote = await revealLocator(joiner, paragraphById(joiner, source.id));
  await expect(remote).toHaveText(anchored);
});

test('concurrent comments keep distinct ids on both peers', async ({ browser, page: creator }) => {
  const joiner = await connectedPeers(browser, creator, EDITABLE);
  await ensureReviewPaneOpen(creator);
  await ensureReviewPaneOpen(joiner);
  const first = await firstTextParagraph(creator);
  const second = creator
    .locator('[data-paragraph-id]:visible')
    .filter({ hasText: 'Second paragraph' });
  await expect(second.first()).toBeVisible();
  const remoteSecond = joiner
    .locator('[data-paragraph-id]:visible')
    .filter({ hasText: 'Second paragraph' });
  await expect(remoteSecond.first()).toBeVisible();

  // No await between the two submits. The stripe exists to keep these ids apart
  // when both peers mint from the same snapshot.
  const aliceAdd = addCommentThroughUi(creator, first.locator, 'Alice concurrent');
  const bobAdd = addCommentThroughUi(joiner, remoteSecond.first(), 'Bob concurrent');
  await Promise.all([aliceAdd, bobAdd]);

  for (const page of [creator, joiner]) {
    await expect(commentCard(page, 'Alice concurrent')).toBeVisible({ timeout: 20_000 });
    await expect(commentCard(page, 'Bob concurrent')).toBeVisible({ timeout: 20_000 });
  }

  const [aliceItems, bobItems] = await Promise.all([reviewItems(creator), reviewItems(joiner)]);
  const aliceIds = commentIdsNamed(aliceItems, ['Alice concurrent', 'Bob concurrent']);
  const bobIds = commentIdsNamed(bobItems, ['Alice concurrent', 'Bob concurrent']);
  expect(aliceIds[0]).not.toBe(aliceIds[1]);
  expect(bobIds[0]).not.toBe(bobIds[1]);
  expect([...aliceIds].sort()).toEqual([...bobIds].sort());

  const [aliceBytes, bobBytes] = await Promise.all([
    savePackageBytes(creator),
    savePackageBytes(joiner),
  ]);
  const aliceSaved = commentsFromPackage(aliceBytes).filter((row) =>
    /Alice concurrent|Bob concurrent/.test(row.text)
  );
  const bobSaved = commentsFromPackage(bobBytes).filter((row) =>
    /Alice concurrent|Bob concurrent/.test(row.text)
  );
  expect(new Set(aliceSaved.map((row) => row.id)).size).toBe(2);
  expect(new Set(bobSaved.map((row) => row.id)).size).toBe(2);
  expect(aliceSaved.map((row) => row.id).sort()).toEqual(bobSaved.map((row) => row.id).sort());
});

test('saved packages from both peers agree after a review session', async ({
  browser,
  page: creator,
}) => {
  const joiner = await connectedPeers(browser, creator, EDITABLE);
  await ensureReviewPaneOpen(joiner);
  const first = await firstTextParagraph(creator);
  await addCommentThroughUi(creator, first.locator, 'Session note');
  const local = commentCard(creator, 'Session note');
  await expect(local).toBeVisible({ timeout: 10_000 });
  await local.click();
  await local.getByTestId('review-reply-input').fill('Session reply');
  await local.getByTestId('review-reply-submit').click();
  await expect(commentCard(joiner, 'Session note')).toBeVisible({ timeout: 20_000 });
  await expect(commentCard(joiner, 'Session note').getByTestId('review-reply')).toContainText(
    'Session reply',
    { timeout: 20_000 }
  );

  // Same `editor.save()` the toolbar Save button calls, from each peer. Zip
  // metadata can differ; the comments part and the review queue must not.
  const [aliceBytes, bobBytes] = await Promise.all([
    savePackageBytes(creator),
    savePackageBytes(joiner),
  ]);
  const aliceComments = commentsFromPackage(aliceBytes).map(commentKey).sort();
  const bobComments = commentsFromPackage(bobBytes).map(commentKey).sort();
  expect(aliceComments).toEqual(bobComments);
  expect(aliceComments.some((row) => row.includes('Session note'))).toBe(true);
  expect(aliceComments.some((row) => row.includes('Session reply'))).toBe(true);
  expect(documentXml(aliceBytes)).toMatch(/w:commentRangeStart|w:commentReference/);
  expect(documentXml(bobBytes)).toMatch(/w:commentRangeStart|w:commentReference/);
});

function commentKey(row: { id: string; author: string; text: string }): string {
  return `${row.id}\t${row.author}\t${row.text}`;
}

function commentIdsNamed(
  items: Awaited<ReturnType<typeof reviewItems>>,
  names: readonly string[]
): string[] {
  return names.map((name) => {
    const item = items.find((entry) => entry.kind === 'comment' && entry.text === name);
    if (!item) throw new Error(`missing comment ${name}`);
    return item.id;
  });
}
