// The stable engine-neutral EditorDriver (comprehensive 4.7; interactive-paginated 4.8): the automation surface both adapters
// expose so the SAME browser scenarios drive React and Vue. Headless coverage of the surface.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditorDriver, displayText } from '../src/index.ts';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/contracts/geometry';
import type { InteractionHostMetrics } from '@docx-editor.dev/core-contract/contracts/interaction';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';
import { contentToClient } from '../src/coordinate-mapper.ts';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 24, y: 36 },
  scrollOffset: { x: 6, y: 10 },
  zoom: 1.5,
};

const docxBytes = (): Uint8Array => writeDocx(createEmptyModel());
function nullHost(): EditorHost {
  return {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('EditorDriver over the production editor', () => {
  test('exposes editability, a display snapshot, save, reopen, and dispose', async () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);

    expect(typeof driver.editable()).toBe('boolean');
    const snap = driver.displaySnapshot();
    expect(snap.pageCount).toBeGreaterThan(0);
    expect(typeof snap.text).toBe('string');

    const buf = await driver.save();
    expect(new Uint8Array(buf).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // PK

    // Reopen round-trips headlessly and returns the reopened display text.
    const reopened = await driver.saveAndReopenText();
    expect(reopened).toBe(driver.displaySnapshot().text);

    driver.dispose();
    expect(editor.getDisplay()).toEqual([]); // disposed the underlying editor
  });

  test('deferred command/query degrade through the driver too', () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);
    expect(driver.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    expect(Array.isArray(driver.query({ type: 'paragraphs' }))).toBe(true);
    expect(driver.selection()).toBeNull();
    driver.dispose();
  });

  test('exposes interaction-frame observations and semanticSelection', () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);
    const frame = driver.interactionFrame();
    expect(driver.frameId()).toEqual(frame.id);
    expect(frame.display.length).toBe(driver.displaySnapshot().pageCount);
    expect(typeof driver.currentPage()).toBe('number');
    expect(typeof driver.focusState().focused).toBe('boolean');
    expect(typeof driver.compositionState().active).toBe('boolean');
    expect(driver.semanticSelection()).toBeNull();
    expect(driver.caretGeometry()).toBeNull();
    expect(driver.selectionGeometry()).toBeNull();
    driver.dispose();
  });

  test('pointerAt requires explicit metrics and resolves loaded content hits', () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);
    const frame = driver.interactionFrame();
    expect(driver.pointerAt({ x: 12, y: 34 }).ok).toBe(false);
    const item = frame.display[0]?.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const cluster = item.clusters[0] ?? { box: item.box };
    const stacked = frame.pageGeometry[0]!.box;
    const content = {
      x: stacked.x + cluster.box.x + cluster.box.width * 0.4,
      y: stacked.y + cluster.box.y + cluster.box.height / 2,
    };
    const client = contentToClient(content, METRICS);
    if (!client.ok) throw new Error('client');
    const pointer = driver.pointerAt(client.value, { hostMetrics: METRICS });
    expect(pointer.ok).toBe(true);
    if (!pointer.ok) throw new Error('pointer');
    expect(pointer.value.role).toBe('editableText');
    driver.dispose();
  });

  test('pageText reconstructs spacing from box geometry (tight word, gap = space, line = newline)', async () => {
    const { pageText } = await import('../src/driver.ts');
    const run = (t: string) => ({
      text: t,
      box: { x: 0, y: 0, width: 0, height: 0 },
      fontFamily: 'A',
      fontSizePx: 5,
      color: { kind: 'auto' as const },
    });
    const t = (x: number, y: number, width: number, text: string) => ({
      kind: 'text' as const,
      box: { x, y, width, height: 10 },
      runs: [run(text)],
      docFrom: 0,
      docTo: text.length,
      blockId: 0,
      scope: { kind: 'body' as const },
    });
    const page: DisplayPage = {
      index: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      // "Hel"+"lo" contiguous (one word), then a gap before "world", then a new line "next".
      items: [t(0, 0, 30, 'Hel'), t(30, 0, 20, 'lo'), t(60, 0, 40, 'world'), t(0, 20, 40, 'next')],
    };
    expect(pageText(page)).toBe('Hello world\nnext');
  });

  test('displayText joins page text with newlines', () => {
    const pages: DisplayPage[] = [
      {
        index: 0,
        box: { x: 0, y: 0, width: 10, height: 10 },
        items: [
          {
            kind: 'text',
            box: { x: 0, y: 0, width: 5, height: 5 },
            runs: [
              {
                text: 'hi',
                box: { x: 0, y: 0, width: 5, height: 5 },
                fontFamily: 'A',
                fontSizePx: 5,
                color: { kind: 'auto' },
              },
            ],
            docFrom: 0,
            docTo: 2,
            blockId: 0,
            scope: { kind: 'body' },
          },
        ],
      },
      { index: 1, box: { x: 0, y: 0, width: 10, height: 10 }, items: [] },
    ];
    expect(displayText(pages)).toBe('hi\n');
  });

  test('focus, setSelection, accessibility, input-host, and authorizeCaret observations', () => {
    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 640,
        height: 480,
        top: 0,
        left: 0,
        right: 640,
        bottom: 480,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(scroll);
    scroll.append(body);
    const zoomedMetrics = { ...IDENTITY_HOST_METRICS, zoom: 1.25 };

    const host: EditorHost = {
      getBodyHostEl: () => body,
      getHfHostEl: () => null,
      getPagesContainer: () => null,
      getScrollContainer: () => scroll,
      getInteractionHostMetrics: () => zoomedMetrics,
      scheduleFrame: (cb) => {
        cb();
        return () => {};
      },
    };

    const editor = createEditor({ host, document: createEditableParagraphFixture() });
    const driver = createEditorDriver(editor);

    expect(driver.interactionHostMetrics()).toEqual(zoomedMetrics);

    const auth = driver.authorizeCaret(0, 0);
    expect(auth.ok).toBe(true);

    const obs = driver.accessibilityObservation();
    expect(obs.focus.focused).toBe(true);
    expect(obs.entries.some((entry) => entry.text === 'primera línea')).toBe(true);

    const hostObs = driver.inputHostObservation();
    expect(hostObs?.attached).toBe(true);
    expect(hostObs?.placementReason).toBe('applied');
    expect(hostObs?.clientRect.width).toBeGreaterThan(0);
    expect(hostObs?.clientRect.height).toBeGreaterThan(0);

    const caretClient = driver.caretClientRect();
    expect(caretClient).not.toBeNull();
    expect(caretClient?.width).toBe(editor.getInteractionFrame().caret!.rect.width * 1.25);
    expect(caretClient?.height).toBe(editor.getInteractionFrame().caret!.rect.height * 1.25);
    if (hostObs && caretClient) {
      expect(Math.abs(hostObs.clientRect.x - caretClient.x)).toBeLessThan(2);
      expect(Math.abs(hostObs.clientRect.y - caretClient.y)).toBeLessThan(2);
    }

    const entries = obs.entries.filter((entry) => entry.role === 'editableParagraph');
    const endOffset = entries[0]!.text.length;
    const set = driver.setSelection({
      frameId: editor.getInteractionFrame().id,
      scope: { kind: 'body' },
      anchor: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: entries[0]!.identity,
        graphemeOffset: endOffset,
        affinity: 'upstream',
      },
      head: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: entries[0]!.identity,
        graphemeOffset: endOffset,
        affinity: 'downstream',
      },
    });
    expect(set.ok).toBe(true);
    expect(driver.focus().ok).toBe(true);

    driver.dispose();
    scroll.remove();
  });
});
