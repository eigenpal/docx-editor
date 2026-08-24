// Opening a LARGE document yields one painted frame before the blocking mount.
//
// What these tests pin down: a document past the yield threshold mounts behind
// `requestAnimationFrame` + a task, and `snapshot().isOpening` is true for exactly that
// window while `isLoading` stays false (the gate-safe flag must not flicker); the
// previous document stays mounted under the window; `save`/`exec` inside the window
// flush the scheduled mount instead of refusing; detach hands the scheduled document to
// the next attach; destroy cancels it; and a SMALL document keeps the synchronous path,
// because every existing synchronous caller depends on it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * Deterministic high-entropy bytes (xorshift32). Deflate cannot compress them, so a
 * filler PART pushes the ZIPPED size past the yield threshold without a body large
 * enough to make the mount itself slow in the test.
 */
function incompressible(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

function docx(body: string, filler?: Uint8Array): Uint8Array {
  const fillerDefault = filler
    ? '<Default Extension="bin" ContentType="application/octet-stream"/>'
    : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${fillerDefault}` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...(filler ? { 'word/media/filler.bin': filler } : {}),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * ~`length` bytes of numbered text: zips well (like real WordprocessingML, ~10–20×)
 * while staying far under the 200× per-entry zip-bomb ratio cap that plain zero-fill
 * trips — the parse must ACCEPT these fixtures, not refuse them.
 */
function compressibleText(length: number): Uint8Array {
  const lines: string[] = [];
  let total = 0;
  for (let line = 1; total < length; line += 1) {
    const text = `filler line ${line} carrying a little ordinary sentence text.\n`;
    lines.push(text);
    total += text.length;
  }
  return strToU8(lines.join('').slice(0, length));
}

/**
 * The shape that motivated the content-size measure: a text-heavy document. It zips
 * SMALL but its UNCOMPRESSED entries cross the threshold, exactly like a 200-page
 * tracked-changes file that zips under 90 KiB.
 */
const LARGE = docx(p('large document body'), compressibleText(1024 * 1024));
/** Past the threshold ZIPPED as well — the shortcut branch of `shouldYield`. */
const LARGE_ZIPPED = docx(p('large zipped body'), incompressible(600 * 1024));
const SMALL = docx(p('small document body'));

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('deferred open of a large document', () => {
  test('a text-heavy document defers on its CONTENT size, not its zipped size', async () => {
    // The regression this pins: a long tracked-changes document zips far under any
    // sensible zipped-size threshold, and the open froze with no loading state.
    expect(LARGE.byteLength).toBeLessThan(512 * 1024);
    const editor = createDocxEditor({ document: LARGE });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.snapshot().isOpening).toBe(true);
    await until(() => editor.surface !== null);
    editor.destroy();
  });

  test('a document past the threshold ZIPPED defers too', async () => {
    expect(LARGE_ZIPPED.byteLength).toBeGreaterThanOrEqual(512 * 1024);
    const editor = createDocxEditor({ document: LARGE_ZIPPED });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.snapshot().isOpening).toBe(true);
    await until(() => editor.surface !== null);
    expect(container.textContent).toContain('large zipped body');
    editor.destroy();
  });

  test('a small document still mounts synchronously', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: SMALL });
    expect(editor.surface).not.toBeNull();
    expect(editor.snapshot().isOpening).toBe(false);
    editor.destroy();
  });

  test('attach schedules the mount: isOpening holds the window, isLoading stays false', async () => {
    const editor = createDocxEditor({ document: LARGE });
    const container = document.createElement('div');
    editor.attach(container);

    expect(editor.surface).toBeNull();
    expect(editor.snapshot().isOpening).toBe(true);
    // The gate-safe flag must not flicker: a host gating its mount point on it would
    // unmount the container the scheduled mount needs.
    expect(editor.snapshot().isLoading).toBe(false);

    await until(() => editor.surface !== null);
    expect(editor.snapshot().isOpening).toBe(false);
    expect(container.textContent).toContain('large document body');
    editor.destroy();
  });

  test('load() over a mounted document keeps the old pages through the window', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: SMALL });
    let selectionEvents = 0;
    editor.on('selectionChange', () => {
      selectionEvents += 1;
    });

    editor.load(LARGE);
    // The old document is still what is on screen; the overlay state says why.
    expect(editor.snapshot().isOpening).toBe(true);
    expect(container.textContent).toContain('small document body');
    // Scheduling emitted, so a subscribed host re-reads and shows its overlay.
    expect(selectionEvents).toBeGreaterThan(0);

    await until(() => container.textContent?.includes('large document body') === true);
    expect(editor.snapshot().isOpening).toBe(false);
    editor.destroy();
  });

  test('load() closes the previous comments pane before it shows the overlay', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: SMALL,
      modules: [stubReviewModule()],
    });
    editor.exec({ type: 'toggleReviewPane' });
    expect(editor.isReviewPaneOpen()).toBe(true);

    editor.load(LARGE);

    expect(editor.snapshot().isOpening).toBe(true);
    expect(editor.isReviewPaneOpen()).toBe(false);
    await until(() => editor.surface?.session.bodyText().includes('large document body') === true);
    expect(editor.isReviewPaneOpen()).toBe(false);
    editor.destroy();
  });

  test('save() inside the window flushes the scheduled mount and answers the new document', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: SMALL });
    editor.load(LARGE);
    expect(editor.snapshot().isOpening).toBe(true);

    const buffer = await editor.save();
    expect(editor.snapshot().isOpening).toBe(false);
    expect(container.textContent).toContain('large document body');
    expect(buffer.byteLength).toBeGreaterThan(0);
    editor.destroy();
  });

  test('exec inside the window flushes the scheduled mount first', () => {
    const editor = createDocxEditor({ document: LARGE });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.surface).toBeNull();

    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    expect(editor.surface).not.toBeNull();
    expect(editor.snapshot().isOpening).toBe(false);
    editor.destroy();
  });

  test('scrollToPage inside the window flushes the scheduled mount and lands', () => {
    const editor = createDocxEditor({ document: LARGE });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.snapshot().isOpening).toBe(true);

    // A host's onReady-style scroll must address the just-loaded document. The reveal
    // itself needs real scroller geometry this bare container does not have; what this
    // pins is the flush — the call finds a MOUNTED document, not the yield window.
    editor.scrollToPage(1);
    expect(editor.surface).not.toBeNull();
    expect(editor.snapshot().isOpening).toBe(false);
    editor.destroy();
  });

  test('detach inside the window hands the scheduled document to the next attach', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: SMALL });
    editor.load(LARGE);
    expect(editor.snapshot().isOpening).toBe(true);

    editor.detach();
    expect(editor.snapshot().isOpening).toBe(false);
    // The scheduled document outranks the bytes saved off the old surface.
    const next = document.createElement('div');
    editor.attach(next);
    await until(() => next.textContent?.includes('large document body') === true);
    editor.destroy();
  });

  test('destroy inside the window cancels the scheduled mount', async () => {
    const editor = createDocxEditor({ document: LARGE });
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.snapshot().isOpening).toBe(true);

    editor.destroy();
    // Give the cancelled frame/task time to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editor.surface).toBeNull();
    expect(container.textContent ?? '').not.toContain('large document body');
  });
});
