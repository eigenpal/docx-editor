import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let pageErrors: string[];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

let imageDirectory: string;
let imagePath: string;
let unsupportedPath: string;
test.beforeAll(async () => {
  imageDirectory = await mkdtemp(join(tmpdir(), 'docx-image-drop-'));
  imagePath = join(imageDirectory, 'drop-picture.png');
  await writeFile(imagePath, Buffer.from(PNG, 'base64'));
  unsupportedPath = join(imageDirectory, 'unsupported.txt');
  await writeFile(unsupportedPath, 'Unsupported file');
});
test.afterAll(async () => {
  if (imageDirectory) await rm(imageDirectory, { recursive: true });
});
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const source = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" ` +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:t>First insertion line.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second insertion line.</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

async function delayImageRead(page: Page): Promise<void> {
  await page.evaluate((png) => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'drop-picture.png') return read.call(this);
      return new Promise((resolve) => {
        (window as unknown as { finishImageRead: () => void }).finishImageRead = () =>
          resolve(Uint8Array.from(atob(png), (c) => c.charCodeAt(0)).buffer);
      });
    };
  }, PNG);
}

async function dragToSecondLine(page: Page, custom = false): Promise<string> {
  const first = page
    .locator('[data-paragraph-id]')
    .filter({ hasText: 'First insertion line.' })
    .first();
  const second = page
    .locator('[data-paragraph-id]')
    .filter({ hasText: 'Second insertion line.' })
    .first();
  await first.click();
  const paragraphId = await second.getAttribute('data-paragraph-id');
  const target = await second.boundingBox();
  if (!target || !paragraphId) throw new Error('missing drag geometry');
  const x = target.x + target.width / 2;
  const y = target.y + target.height / 2;
  if (custom) {
    const source = await page.locator('#picture-source').boundingBox();
    if (!source) throw new Error('missing drag source');
    await page.mouse.move(source.x + 10, source.y + 10);
    await page.mouse.down();
    await page.mouse.move(source.x + 30, source.y + 15, { steps: 4 });
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.move(x + 1, y);
    await expect(page.locator('[data-docx-drop-caret]')).toBeVisible();
    await page.mouse.up();
  } else {
    // CDP supplies a real file drag. A script-created File becomes filename text in native Chrome drags.
    const session = await page.context().newCDPSession(page);
    const data = {
      items: [],
      files: [imagePath],
      dragOperationsMask: 1,
    };
    await session.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await session.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await expect(page.locator('[data-docx-drop-caret]')).toBeVisible();
    await session.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
    await session.detach();
  }
  await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
  return paragraphId;
}

async function refusedFileDrop(page: Page, file: string): Promise<void> {
  const target = page
    .locator('[data-paragraph-id]')
    .filter({ hasText: 'Second insertion line.' })
    .first();
  const box = await target.boundingBox();
  if (!box) throw new Error('missing drop target');
  const session = await page.context().newCDPSession(page);
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const url = page.url();
  await session.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await session.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
  await session.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await session.detach();
  await expect(target).toHaveText('Second insertion line.');
  await expect(page.locator('[data-drawing-paragraph-id]')).toHaveCount(0);
  expect(page.url()).toBe(url);
}

for (const adapter of ['react', 'vue'] as const) {
  test.describe(`${adapter} image drops`, () => {
    test.beforeEach(async ({ page }) => {
      await page.route('**/sample.docx', (route) =>
        route.fulfill({
          body: Buffer.from(source),
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      );
      await page.goto(
        adapter === 'react' ? 'http://localhost:5273/?e2e=1' : 'http://localhost:5274/'
      );
      await expect(
        page.locator('[data-paragraph-id]').filter({ hasText: 'Second insertion line.' }).first()
      ).toBeVisible({ timeout: 30_000 });
    });

    test('native image dragging previews the pointer and inserts at its paragraph', async ({
      page,
    }) => {
      const paragraphId = await dragToSecondLine(page);
      await expect(page.locator(`[data-drawing-paragraph-id="${paragraphId}"]`)).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('[data-drawing-paragraph-id]')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(page.locator(`[data-drawing-paragraph-id="${paragraphId}"]`)).toHaveCount(1);
      await page.keyboard.type('dropped');
      await expect(page.locator(`[data-paragraph-id="${paragraphId}"]`).first()).toContainText(
        'dropped'
      );
    });

    if (adapter === 'react') {
      test('a custom MIME handler inserts its image at the resolved drop target', async ({
        page,
      }) => {
        await page.evaluate((png) => {
          const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
          const mime = 'application/x-docx-test-picture';
          editor.on('dragOver', ({ event }) => {
            if (event.dataTransfer?.types.includes(mime)) event.preventDefault();
          });
          editor.on('drop', ({ event, position }) => {
            if (!event.dataTransfer?.types.includes(mime)) return;
            event.preventDefault();
            void editor.executeImageCommand({
              type: 'insertImage',
              at: position,
              data: Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
              mime: 'image/png',
              widthPoints: 12,
              heightPoints: 12,
            });
          });
          const source = document.createElement('button');
          source.id = 'picture-source';
          source.textContent = 'Drag custom picture';
          source.draggable = true;
          source.style.cssText = 'position:fixed;left:8px;top:200px;z-index:10000';
          source.addEventListener('dragstart', (event) => {
            event.dataTransfer!.setData(mime, 'test-picture');
            event.dataTransfer!.effectAllowed = 'copy';
          });
          document.body.append(source);
        }, PNG);
        const paragraphId = await dragToSecondLine(page, true);
        await expect(page.locator(`[data-drawing-paragraph-id="${paragraphId}"]`)).toHaveCount(1);
      });
    }

    test('viewing mode refuses file drops without a caret or navigation', async ({ page }) => {
      if (adapter === 'react') {
        await page.evaluate(() =>
          window.__DOCX_EDITOR_E2E__!.getEditor()!.setEditingMode('viewing')
        );
      } else {
        await page.getByTestId('editing-mode-trigger').first().click();
        await page.getByTestId('editing-mode-viewing').first().click();
      }
      await refusedFileDrop(page, imagePath);
    });

    test('unsupported file drops keep the document open and unchanged', async ({ page }) => {
      await refusedFileDrop(page, unsupportedPath);
    });

    test('a delayed image read retains the drop target after a selection move', async ({
      page,
    }) => {
      await delayImageRead(page);
      const paragraphId = await dragToSecondLine(page);
      await page.waitForFunction(
        () => !!(window as unknown as { finishImageRead?: () => void }).finishImageRead
      );
      await page
        .locator('[data-paragraph-id]')
        .filter({ hasText: 'First insertion line.' })
        .first()
        .click();
      await page.evaluate(() =>
        (window as unknown as { finishImageRead: () => void }).finishImageRead()
      );
      await expect(page.locator(`[data-drawing-paragraph-id="${paragraphId}"]`)).toHaveCount(1);
    });

    test('a delayed drop does not steal focus from another input', async ({ page }) => {
      await delayImageRead(page);
      const paragraphId = await dragToSecondLine(page);
      await page.waitForFunction(
        () => !!(window as unknown as { finishImageRead?: () => void }).finishImageRead
      );
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'external-input';
        input.style.cssText = 'position:fixed;left:8px;top:200px;z-index:10000';
        document.body.append(input);
      });
      const input = page.locator('#external-input');
      await input.click();
      await page.evaluate(() =>
        (window as unknown as { finishImageRead: () => void }).finishImageRead()
      );
      await expect(page.locator(`[data-drawing-paragraph-id="${paragraphId}"]`)).toHaveCount(1);
      await expect(input).toBeFocused();
      await page.keyboard.type('kept focus');
      await expect(input).toHaveValue('kept focus');
    });

    test('an edit during a delayed image read refuses the stale drop', async ({ page }) => {
      await delayImageRead(page);
      await dragToSecondLine(page);
      await page.waitForFunction(
        () => !!(window as unknown as { finishImageRead?: () => void }).finishImageRead
      );
      await page
        .locator('[data-paragraph-id]')
        .filter({ hasText: 'First insertion line.' })
        .first()
        .click();
      await page.keyboard.type('changed');
      await page.evaluate(() =>
        (window as unknown as { finishImageRead: () => void }).finishImageRead()
      );
      await expect(page.locator('[data-docx-dialog="imageInsertError"]')).toBeVisible();
      await expect(page.locator('[data-drawing-paragraph-id]')).toHaveCount(0);
    });
  });
}
