// Fit-to-viewport zoom, wired into a real editor.
//
// `zoom-fit.test.ts` covers the arithmetic. This covers the parts that only exist once there
// is a document, a scroll container and an observer: that a fit resolves before the first
// paint, that it tracks the CONTENT box (so reserving a gutter for the comments rail shrinks
// the document with no other wiring), that picking a level ends the fit for good, and that a
// refit is PUBLISHED rather than only readable.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { AUTO_ZOOM_MODE } from '../zoom-fit.ts';
import type { EditorSnapshot } from '../../contracts/editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(_body?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

// ── A viewport we can resize ────────────────────────────────────────────────────────────
//
// happy-dom lays nothing out, so `clientWidth` is 0 and every fit would answer "unmeasurable".
// These fakes stand in for the two numbers the controller reads off the scroller, and the
// observer stand-in lets a test deliver the callback a browser would deliver on a resize.

let observerCallbacks: (() => void)[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {
    observerCallbacks.push(callback);
  }
  observe(): void {}
  disconnect(): void {
    observerCallbacks = observerCallbacks.filter((entry) => entry !== this.callback);
  }
}

interface Harness {
  editor: DocxEditorInstance;
  /** Set the scroller's border-box width, as a window resize would. */
  resize(width: number): void;
  /** Reserve room at the inline end, exactly as the open comments rail's padding does. */
  reserve(px: number): void;
  /** Reserve room at the inline start, as the docked navigation pane's padding does. */
  reserveStart(px: number): void;
  /** Deliver the resize callback and let the coalescing frame run. */
  settle(): Promise<void>;
}

function mount(options: Parameters<typeof createDocxEditor>[0] = {}): Harness {
  const scroller = document.createElement('div');
  scroller.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroller.appendChild(container);
  document.body.appendChild(scroller);

  let width = 1600;
  Object.defineProperty(scroller, 'clientWidth', { get: () => width, configurable: true });

  const editor = createDocxEditor({ container, document: docx(''), ...options });

  return {
    editor,
    resize(next) {
      width = next;
    },
    reserve(px) {
      scroller.style.paddingRight = `${px}px`;
    },
    reserveStart(px) {
      scroller.style.paddingLeft = `${px}px`;
    },
    async settle() {
      for (const callback of [...observerCallbacks]) callback();
      // Two frames: one for the controller's coalescing rAF, one to be sure it ran.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
  };
}

beforeEach(() => {
  observerCallbacks = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the default mode', () => {
  test('is auto: a window with room for the sheet opens at 100%, exactly as before', () => {
    const { editor } = mount();
    expect(editor.getZoomMode()).toEqual(AUTO_ZOOM_MODE);
    expect(editor.getZoom()).toBe(1);
  });

  // Synchronously, inside the mount — a fit resolved a frame later paints 100% first and
  // corrects itself, which reads as a flinch on every open.
  test('fits a narrow window before the first paint, not after it', () => {
    const harness = mount();
    harness.resize(700);
    // Re-open at the narrow width rather than resizing an open document, so this asserts the
    // mount path and not the observer path.
    harness.editor.load(docx(''));

    expect(harness.editor.getZoom()).toBeLessThan(1);
    expect(harness.editor.getZoom()).toBeGreaterThan(0.5);
  });

  test('a configured zoom means the embedder pinned it, so the mode is fixed', () => {
    const { editor } = mount({ zoom: 1.5 });
    expect(editor.getZoomMode()).toEqual({ type: 'fixed' });
    expect(editor.getZoom()).toBe(1.5);
  });

  test('an explicit fixed mode keeps the old unconditional behaviour', async () => {
    const harness = mount({ zoomMode: { type: 'fixed' } });
    harness.resize(400);
    await harness.settle();
    expect(harness.editor.getZoom()).toBe(1);
  });

  // A fixed editor tracks nothing, so it has no reason to watch anything. It used to install
  // an observer anyway and pay a scheduled frame per resize tick to reach an early return.
  test('a fixed editor installs no observer at all', () => {
    observerCallbacks = [];
    mount({ zoomMode: { type: 'fixed' } });
    expect(observerCallbacks).toHaveLength(0);
  });
});

describe('tracking the viewport', () => {
  test('a resize refits', async () => {
    const harness = mount();
    harness.resize(700);
    await harness.settle();

    expect(harness.editor.getZoom()).toBeLessThan(1);
  });

  // The feature behind "opening comments shrinks the document". Nothing here tells the engine
  // a pane opened: the rail reserves room with padding, and the fit measures the content box.
  test('reserving a gutter shrinks the document by exactly what it took', async () => {
    const harness = mount();
    harness.resize(1100);
    await harness.settle();
    const wide = harness.editor.getZoom();

    harness.reserve(316);
    await harness.settle();

    expect(harness.editor.getZoom()).toBeLessThan(wide);
  });

  // The other half of the "PHYSICAL, not logical" rule in `availableWidth`: the navigation
  // pane reserves with `padding-inline-start`, which computed style resolves to `paddingLeft`.
  test('a reservation at the inline start shrinks the document too', async () => {
    const harness = mount();
    harness.resize(1100);
    await harness.settle();
    const wide = harness.editor.getZoom();

    harness.reserveStart(328);
    await harness.settle();

    expect(harness.editor.getZoom()).toBeLessThan(wide);
  });

  test('a refit is PUBLISHED, not just readable', async () => {
    const harness = mount();
    const seen: number[] = [];
    harness.editor.on('selectionChange', (snapshot: EditorSnapshot) => seen.push(snapshot.zoom));

    harness.resize(700);
    await harness.settle();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(harness.editor.getZoom());
    expect(seen.at(-1)).toBeLessThan(1);
  });

  test('the snapshot carries the mode as well as the resolved scale', () => {
    const { editor } = mount();
    expect(editor.snapshot().zoomMode).toBe(editor.getZoomMode());
  });

  test('a resize that lands on the same percent applies nothing', async () => {
    const harness = mount();
    harness.resize(720);
    await harness.settle();
    const before = harness.editor.snapshot();

    harness.resize(722);
    await harness.settle();

    // Same reference: nothing about the editor moved, so `snapshot()` must not mint a new one.
    expect(harness.editor.snapshot()).toBe(before);
  });

  test('an unmeasurable viewport leaves the scale alone rather than guessing', async () => {
    const harness = mount();
    // Fit to something OTHER than 1 first. Asserting 1 from a standing start passes for an
    // implementation that resolves an unmeasurable viewport to 1 — the exact guess `fitZoom`
    // returns null to avoid.
    harness.resize(700);
    await harness.settle();
    const fitted = harness.editor.getZoom();
    expect(fitted).toBeLessThan(1);

    harness.resize(0);
    await harness.settle();

    expect(harness.editor.getZoom()).toBe(fitted);
  });
});

describe('a page that changes size', () => {
  // The other numerator. A fit is page-against-room, and turning the paper landscape moves
  // the page by 25% with the room untouched.
  test('turning the page landscape refits', () => {
    const harness = mount();
    harness.resize(1100);
    const before = harness.editor.getZoom();

    harness.editor.exec({ type: 'setPageSetup', orientation: 'landscape' });

    expect(harness.editor.getZoom()).toBeLessThan(before);
  });

  // UNDO reaches the surface without passing any command hook — the keymap calls
  // `surface.undo()` directly, and `exec({type:'undo'})` carries type 'undo'. Hooking only
  // `setPageSetup` left the document rendered at the landscape scale with a portrait page.
  test('undoing it refits back', () => {
    const harness = mount();
    harness.resize(1100);
    const portrait = harness.editor.getZoom();
    harness.editor.exec({ type: 'setPageSetup', orientation: 'landscape' });
    expect(harness.editor.getZoom()).not.toBe(portrait);

    harness.editor.exec({ type: 'undo' });

    expect(harness.editor.getZoom()).toBe(portrait);
  });

  // The guard that makes the commit hook affordable: a commit that only moved text must not
  // pay for a DOM measurement.
  test('typing does not refit', async () => {
    const harness = mount();
    harness.resize(700);
    await harness.settle();
    const before = harness.editor.snapshot();

    harness.editor.surface!.type('x');

    expect(harness.editor.getZoom()).toBe(before.zoom);
  });
});

describe('the floor', () => {
  // A phone with the 316px comments rail open leaves the page a sliver. Fitting into it is a
  // document nobody can read, traded for a scrollbar nobody minds.
  test('auto stops shrinking and lets the container overflow', async () => {
    const harness = mount();
    harness.resize(420);
    harness.reserve(316);
    await harness.settle();

    expect(harness.editor.getZoom()).toBe(0.5);
  });
});

describe('leaving and re-entering the fit', () => {
  test('picking a level ends the fit, and a later resize does not take it back', async () => {
    const harness = mount();
    expect(harness.editor.setZoom(1.5).ok).toBe(true);
    expect(harness.editor.getZoomMode()).toEqual({ type: 'fixed' });

    harness.resize(700);
    await harness.settle();

    expect(harness.editor.getZoom()).toBe(1.5);
  });

  // Picking the percentage the fit had already landed on still ends the fit. Without this,
  // choosing "100%" on a wide window did nothing and the next resize moved the page again.
  test('picking the level the fit already resolved to still ends the fit', () => {
    const harness = mount();
    expect(harness.editor.getZoom()).toBe(1);

    const result = harness.editor.setZoom(1);

    expect(result).toEqual({ ok: true, changed: true });
    expect(harness.editor.getZoomMode()).toEqual({ type: 'fixed' });
  });

  test('setZoomMode goes back to fitting and applies on the call, not on the next resize', async () => {
    const harness = mount();
    harness.editor.setZoom(1.5);
    harness.resize(700);
    await harness.settle();
    expect(harness.editor.getZoom()).toBe(1.5);

    expect(harness.editor.setZoomMode('auto').ok).toBe(true);

    expect(harness.editor.getZoom()).toBeLessThan(1);
  });

  test('refuses a mode it does not know rather than substituting one', () => {
    const { editor } = mount();
    const result = editor.setZoomMode('fit' as never);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'invalidArgs' });
    expect(editor.getZoomMode()).toEqual(AUTO_ZOOM_MODE);
  });

  test('setting the mode already in force changes nothing', () => {
    const { editor } = mount();
    expect(editor.setZoomMode('auto')).toEqual({ ok: true, changed: false });
  });
});

describe('lifecycle', () => {
  // The observer is on a scroller found through the OLD container, and only a successful mount
  // re-targets it. A load that failed to parse leaves no surface and no pending bytes, so
  // attaching to a new element took the do-nothing branch and left the observer watching an
  // element the editor no longer used — keeping it alive if the host had dropped it.
  test('moving to a new container after a failed load drops the old observer', () => {
    const harness = mount();
    // A load that cannot parse leaves no surface and no pending bytes, so `attach` takes the
    // do-nothing branch and installs nothing. The observer on the OLD scroller has to go
    // anyway — asserting "no new observer" would pass with the teardown deleted.
    harness.editor.load(new Uint8Array([1, 2, 3]));
    expect(observerCallbacks).toHaveLength(1);

    harness.editor.attach(document.createElement('div'));

    expect(observerCallbacks).toHaveLength(0);
  });

  // On the OBSERVER, not on the resulting zoom: `detach` and `destroy` also null the container,
  // so a refit early-returns either way and a zoom assertion passes with the teardown deleted.
  // What these guard is a lifetime — an observer left running on an element the editor no
  // longer uses, holding it alive.
  test('detach stops the observer, so a detached editor is not re-fitted', async () => {
    const harness = mount();
    expect(observerCallbacks).toHaveLength(1);

    harness.editor.detach();

    expect(observerCallbacks).toHaveLength(0);
    harness.resize(400);
    await harness.settle();
    expect(harness.editor.getZoom()).toBe(1);
  });

  test('destroy stops it too', () => {
    const harness = mount();
    expect(observerCallbacks).toHaveLength(1);

    harness.editor.destroy();

    expect(observerCallbacks).toHaveLength(0);
  });
});
