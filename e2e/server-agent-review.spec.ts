import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore the sample/ }).click();
  await expect(page.getByText('Live document', { exact: true })).toBeVisible();
  return page.url();
}
async function join(page: Page, url: string, name = 'Sam') {
  await page.goto(url);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByText('Live document', { exact: true })).toBeVisible();
}
async function changes(page: Page) {
  await page.getByRole('tab', { name: /Changes/ }).click();
}

test('server redlines stream to two peers, merge with human edits, and decisions converge', async ({
  browser,
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const url = await create(page);
  const secondContext = await browser.newContext();
  const peer = await secondContext.newPage();
  try {
    await join(peer, url);
    await expect(page.getByLabel('Collaborators').getByLabel('Sam', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Start review/ }).click();
    await expect(
      page.getByLabel('Collaborators').getByLabel('Review agent', { exact: true })
    ).toBeVisible();
    await changes(peer);
    await expect(peer.locator('.change-card')).toHaveCount(1);
    const paragraph = peer
      .locator('[data-paragraph-id]:visible')
      .filter({ hasText: '01  Scope' })
      .first();
    // A human edits a separate paragraph while the worker continues creating suggestions.
    await paragraph.click();
    await peer.keyboard.press('End');
    await peer.keyboard.type(' — agreed');
    await expect(page.locator('.document-pane')).toContainText('agreed');
    await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
    await changes(page);
    await expect(page.locator('.change-card')).toHaveCount(4);
    await expect(peer.locator('.change-card')).toHaveCount(4);
    await page.screenshot({ path: info.outputPath('review-room.png'), fullPage: true });
    await page
      .locator('.change-card')
      .filter({ hasText: '7 days' })
      .getByRole('button', { name: 'Accept ✓' })
      .click();
    await expect(peer.locator('.change-card')).toHaveCount(3);
    await peer
      .locator('.change-card')
      .filter({ hasText: 'may terminate immediately' })
      .getByRole('button', { name: 'Reject', exact: true })
      .click();
    await expect(page.locator('.change-card')).toHaveCount(2);
    const roomId = new URL(url).searchParams.get('room');
    const response = await page.request.get(
      `/api/rooms/${roomId}/download?token=review-demo-token`
    );
    expect(response.ok()).toBe(true);
    const zip = await JSZip.loadAsync(await response.body());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Review agent');
    expect(xml).toContain('30 days');
    expect(xml).toContain('agreed');
    expect(xml).not.toContain('30 days’ written notice');
    expect(errors).toEqual([]);
  } finally {
    await secondContext.close();
  }
});

test('worker continues after the initiating browser closes; rejoin sees completed review', async ({
  browser,
  page,
}) => {
  const url = await create(page);
  await page.getByRole('button', { name: /^Start review/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.close();
  const context = await browser.newContext();
  const peer = await context.newPage();
  try {
    await join(peer, url, 'Returning reviewer');
    await expect(peer.getByText('Review complete', { exact: true })).toBeVisible();
    await changes(peer);
    await expect(peer.locator('.change-card')).toHaveCount(4);
  } finally {
    await context.close();
  }
});

test('cancellation preserves earlier proposals and stops subsequent ones', async ({ page }) => {
  const url = await create(page);
  await page.getByRole('button', { name: /^Start review/ }).click();
  await expect(page.getByRole('button', { name: '1 suggestion committed →' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  const roomId = new URL(url).searchParams.get('room');
  const response = await page.request.get(`/api/rooms/${roomId}?token=review-demo-token`);
  const { job } = await response.json();
  expect(job.state).toBe('cancelled');
  expect(job.proposals).toBe(1);
  await changes(page);
  await expect(page.locator('.change-card')).toHaveCount(1);
});

test('upload creates a new room; narrow layout and dark theme remain usable', async ({
  page,
}, info) => {
  const original = await create(page);
  const id = new URL(original).searchParams.get('room');
  const document = await page.request.get(`/api/rooms/${id}/download?token=review-demo-token`);
  await page.getByLabel('Upload DOCX', { exact: true }).setInputFiles({
    name: 'My agreement.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await document.body(),
  });
  await expect(page.getByRole('heading', { name: 'My agreement' })).toBeVisible();
  expect(page.url()).not.toBe(original);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Start review/ })).toBeVisible();
  await expect
    .poll(async () => {
      const panel = await page
        .getByRole('complementary', { name: 'Document review' })
        .boundingBox();
      return panel && panel.x >= 0 && panel.x + panel.width <= 391;
    })
    .toBe(true);
  await page.screenshot({ path: info.outputPath('review-mobile-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close review panel' }).click();
  await expect(page.getByRole('button', { name: /^Start review/ })).not.toBeVisible();
});

test('Back and Forward keep the room URL, attachment, and document together', async ({ page }) => {
  const firstUrl = await create(page);
  const id = new URL(firstUrl).searchParams.get('room');
  const document = await page.request.get(`/api/rooms/${id}/download?token=review-demo-token`);
  await page.getByLabel('Upload DOCX', { exact: true }).setInputFiles({
    name: 'Second room.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await document.body(),
  });
  await expect(page.getByRole('heading', { name: 'Second room' })).toBeVisible();
  const secondUrl = page.url();
  await page.goBack();
  await page.getByRole('button', { name: /^Join Northstar/ }).click();
  await expect(page.getByText('Live document', { exact: true })).toBeVisible();
  expect(page.url()).toBe(firstUrl);
  await expect(page.getByRole('heading', { name: 'Northstar · Services agreement' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download ↓' })).toHaveAttribute(
    'href',
    `/api/rooms/${id}/download?token=review-demo-token`
  );
  await page.goForward();
  await page.getByRole('button', { name: /^Join Second room/ }).click();
  await expect(page.getByText('Live document', { exact: true })).toBeVisible();
  expect(page.url()).toBe(secondUrl);
  await expect(page.getByRole('heading', { name: 'Second room' })).toBeVisible();
});

test('a delayed start response cannot overwrite completed SSE progress', async ({ page }) => {
  await create(page);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/rooms/*/jobs', async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: /^Start review/ }).click();
  try {
    await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: /^Start review/ })).toBeEnabled();
  await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '4 suggestions committed →' })).toBeVisible();
});

test('imported paragraph-break deletions describe the actual review decision', async ({ page }) => {
  const url = await create(page);
  const id = new URL(url).searchParams.get('room');
  const download = await page.request.get(`/api/rooms/${id}/download?token=review-demo-token`);
  const zip = await JSZip.loadAsync(await download.body());
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:rPr><w:del w:id="1" w:author="Imported reviewer" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>`
  );
  await page.getByLabel('Upload DOCX', { exact: true }).setInputFiles({
    name: 'Imported revisions.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.getByRole('heading', { name: 'Imported revisions' })).toBeVisible();
  await changes(page);
  await expect(page.getByText('Paragraph break deleted', { exact: true })).toBeVisible();
  await expect(page.locator('.change-card ins')).toHaveCount(0);
  await page.getByRole('button', { name: 'Accept ✓', exact: true }).click();
  await expect(page.locator('.change-card')).toHaveCount(0);
  const href = await page.getByRole('link', { name: 'Download ↓' }).getAttribute('href');
  const exported = await page.request.get(href!);
  const saved = await JSZip.loadAsync(await exported.body());
  const xml = await saved.file('word/document.xml')!.async('string');
  expect(xml.match(/<w:p(?:\s|>)/g)).toHaveLength(1);
  expect([...xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((match) => match[1]).join('')).toBe(
    'First paragraphSecond paragraph'
  );
});
