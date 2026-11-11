import { expect, test, type Page } from '@playwright/test';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
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
function sourceForBody(body: string): Uint8Array {
  return zipSync({
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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}
const firstLines =
  '<w:p><w:r><w:t>First insertion line.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second insertion line.</w:t></w:r></w:p>';
const source = sourceForBody(firstLines);
const longSource = sourceForBody(
  firstLines +
    Array.from(
      { length: 180 },
      (_, index) =>
        `<w:p><w:r><w:t>Scroll target paragraph ${index}. Keep dragging toward the viewport edge.</w:t></w:r></w:p>`
    ).join('')
);

const drawing =
  '<w:r><w:drawing>' +
  '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Drag picture"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Drag picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const pictureEntries = unzipSync(sourceForBody(firstLines.replace('</w:p>', `${drawing}</w:p>`)));
pictureEntries['[Content_Types].xml'] = strToU8(
  strFromU8(pictureEntries['[Content_Types].xml']!).replace(
    '</Types>',
    '<Default Extension="png" ContentType="image/png"/></Types>'
  )
);
pictureEntries['word/_rels/document.xml.rels'] = strToU8(
  `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>'
);
pictureEntries['word/media/picture.png'] = new Uint8Array(Buffer.from(PNG, 'base64'));
const pictureSource = zipSync(pictureEntries);
const longPictureSource = zipSync({
  ...pictureEntries,
  'word/document.xml': strToU8(
    strFromU8(pictureEntries['word/document.xml']!).replace(
      '</w:body>',
      Array.from(
        { length: 180 },
        (_, index) =>
          `<w:p><w:r><w:t>Picture scroll target ${index}. Keep dragging toward the viewport edge.</w:t></w:r></w:p>`
      ).join('') + '</w:body>'
    )
  ),
});

async function startTextDrag(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(() => {
    const source = document.createElement('button');
    source.id = 'text-drag-source';
    source.textContent = 'Drag text';
    source.draggable = true;
    source.style.cssText = 'position:fixed;left:8px;top:200px;z-index:10000';
    source.addEventListener('dragstart', (event) => {
      event.dataTransfer!.setData('text/plain', 'Dropped text');
      event.dataTransfer!.effectAllowed = 'copy';
    });
    document.body.append(source);
  });
  const source = await page.locator('#text-drag-source').boundingBox();
  if (!source) throw new Error('missing text drag source');
  await page.mouse.move(source.x + 10, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 15, { steps: 4 });
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x + 1, y);
}

async function replaceFixture(page: Page, bytes: Uint8Array): Promise<void> {
  await page.route('**/sample.docx', (route) =>
    route.fulfill({
      body: Buffer.from(bytes),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  );
  await page.reload();
  await expect(
    page.locator('[data-paragraph-id]').filter({ hasText: 'Second insertion line.' }).first()
  ).toBeVisible();
}

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

async function refusedFileDrop(page: Page, file: string, reason: string): Promise<void> {
  const target = page
    .locator('[data-paragraph-id]')
    .filter({ hasText: 'Second insertion line.' })
    .first();
  // The page paints after load; read the geometry only once the paragraph is on screen.
  await expect(target).toBeVisible();
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
  await expect(page.locator('[data-docx-drop-rejection]')).toBeVisible();
  await expect(page.locator('[data-docx-drop-rejection]')).toHaveAttribute('role', 'status');
  await expect(page.locator('[data-docx-drop-rejection]')).toContainText(reason);
  await session.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await session.detach();
  await expect(page.locator('[data-docx-drop-rejection]')).toHaveCount(0);
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
      await refusedFileDrop(page, imagePath, 'read-only');
    });

    test('unsupported file drops keep the document open and unchanged', async ({ page }) => {
      await refusedFileDrop(page, unsupportedPath, 'PNG');
    });

    test('a missing target shows feedback and an accepted target clears it', async ({ page }) => {
      // A late repaint can replace the page element just after load; wait for stable geometry.
      let sheet: { x: number; y: number } | null = null;
      await expect
        .poll(async () => (sheet = await page.locator('.docx-page').first().boundingBox()))
        .not.toBeNull();
      await startTextDrag(page, sheet!.x + 20, sheet!.y + 20);
      await expect(page.locator('[data-docx-drop-rejection]')).toContainText('editable text');
      await page.screenshot({ path: test.info().outputPath('drop-rejection.png') });
      await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
      const target = await page
        .locator('[data-paragraph-id]')
        .filter({ hasText: 'Second insertion line.' })
        .first()
        .boundingBox();
      if (!target) throw new Error('missing target geometry');
      await page.mouse.move(target.x + 20, target.y + target.height / 2, { steps: 8 });
      await page.mouse.move(target.x + 21, target.y + target.height / 2);
      await expect(page.locator('[data-docx-drop-rejection]')).toHaveCount(0);
      await expect(page.locator('[data-docx-drop-caret]')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
      await expect(page.locator('[data-docx-drop-rejection]')).toHaveCount(0);
      await expect(page.locator('[data-drawing-paragraph-id]')).toHaveCount(0);
      await expect(
        page.locator('[data-paragraph-id]').filter({ hasText: 'Second insertion line.' }).first()
      ).toHaveText('Second insertion line.');
    });

    test('a stationary edge drag scrolls across pages and clears its preview', async ({ page }) => {
      await replaceFixture(page, longSource);
      const scroller = page.locator('.docx-editor__scroll-container').first();
      const scrollBox = await scroller.boundingBox();
      const textBox = await page
        .locator('[data-paragraph-id]')
        .filter({ hasText: 'Second insertion line.' })
        .first()
        .boundingBox();
      if (!scrollBox || !textBox) throw new Error('missing scroll geometry');
      const viewportHeight = await page.evaluate(() => innerHeight);
      const x = textBox.x + 40;
      const y = Math.min(scrollBox.y + scrollBox.height, viewportHeight) - 8;
      await startTextDrag(page, x, y);
      // No more pointer events: the controller must keep scrolling across page gaps.
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 8000 })
        .toBeGreaterThan(1100);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      // End Chrome's native drag autopan; the internal pointer test checks stationary cancellation.
      await page.mouse.move(x, scrollBox.y + scrollBox.height / 2);
      await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
      await expect(page.locator('[data-docx-drop-rejection]')).toHaveCount(0);
      await expect(page.locator('[data-drawing-paragraph-id]')).toHaveCount(0);
    });

    test('inline image edge scrolling stops at Escape with the pointer stationary', async ({
      page,
    }) => {
      await replaceFixture(page, longPictureSource);
      const image = page.locator('.docx-drawing-ready').first();
      await expect(image).toBeVisible();
      const imageId = await image.getAttribute('data-drawing-node-id');
      const firstId = await page
        .locator('[data-paragraph-id]')
        .filter({ hasText: 'First insertion line.' })
        .first()
        .getAttribute('data-paragraph-id');
      const start = await image.boundingBox();
      const scroller = page.locator('.docx-editor__scroll-container').first();
      const scrollBox = await scroller.boundingBox();
      if (!start || !scrollBox) throw new Error('missing inline scroll geometry');
      const viewportHeight = await page.evaluate(() => innerHeight);
      const x = start.x + start.width / 2;
      const y = Math.min(scrollBox.y + scrollBox.height, viewportHeight) - 8;
      await page.mouse.move(x, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 16 });
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop), { timeout: 8000 })
        .toBeGreaterThan(1100);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
      await expect(page.locator('[data-docx-drop-rejection]')).toHaveCount(0);
      const stoppedAt = await scroller.evaluate((element) => element.scrollTop);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let frames = 0;
            const tick = () => {
              if (++frames === 8) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          })
      );
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(stoppedAt);
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(page.locator(`[data-drawing-paragraph-id="${firstId}"]`)).toHaveCount(1);
      await expect(image).toHaveAttribute('data-drawing-node-id', imageId!);
      await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeDisabled();
      const selectedFrame = page.locator('.docx-image-selection-overlay__frame');
      if (await selectedFrame.count()) await selectedFrame.click();
      else await image.click();
      await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeDisabled();
    });

    for (const selected of [false, true]) {
      test(`moves an inline image through its ${selected ? 'selected frame' : 'painted image'}`, async ({
        page,
      }) => {
        await replaceFixture(page, pictureSource);
        const image = page.locator('.docx-drawing-ready').first();
        await expect(image).toBeVisible();
        const imageId = await image.getAttribute('data-drawing-node-id');
        const firstId = await page
          .locator('[data-paragraph-id]')
          .filter({ hasText: 'First insertion line.' })
          .first()
          .getAttribute('data-paragraph-id');
        const second = page
          .locator('[data-paragraph-id]')
          .filter({ hasText: 'Second insertion line.' })
          .first();
        const secondId = await second.getAttribute('data-paragraph-id');
        if (selected) await image.click();
        const start = await (
          selected ? page.locator('.docx-image-selection-overlay__frame') : image
        ).boundingBox();
        const end = await second.boundingBox();
        if (!start || !end) throw new Error('missing move geometry');
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
        await expect(page.locator('[data-docx-drop-caret]')).toBeVisible();
        await page.screenshot({ path: test.info().outputPath('inline-drag-caret.png') });
        await page.mouse.up();
        await expect(page.locator('[data-docx-drop-caret]')).toHaveCount(0);
        await expect(page.locator(`[data-drawing-paragraph-id="${secondId}"]`)).toHaveCount(1);
        await expect(page.locator('.docx-drawing-ready')).toHaveCount(1);
        await expect(page.locator('.docx-drawing-ready')).toHaveAttribute(
          'data-drawing-node-id',
          imageId!
        );
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.locator(`[data-drawing-paragraph-id="${firstId}"]`)).toHaveCount(1);
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await expect(page.locator(`[data-drawing-paragraph-id="${secondId}"]`)).toHaveCount(1);
      });
    }

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
