// The adapter half of fit-to-viewport zoom.
//
// The engine owns the fit itself (`packages/core/src/editor/__tests__/zoom-controller.test.ts`).
// What lives here is what React contributes: the `useZoom` hook a host builds a control from,
// and the one rule that keeps the navigation pane and the fit from chasing each other.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useZoom, type UseZoomResult } from '../src/editor/useZoom.ts';
import { navigationShift } from '../src/editor/navigation/navigation-geometry.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});

/** happy-dom lays nothing out, so the Viewport's own width has to be supplied. */
let viewportWidth = 1600;

class WidthObserver {
  constructor(private readonly callback: (entries: unknown[]) => void) {
    observers.push(this);
  }
  observe(): void {}
  disconnect(): void {
    observers = observers.filter((entry) => entry !== this);
  }
  // An empty entry list, not no argument: other observers in the tree iterate what they are
  // handed, and calling one bare throws inside the component rather than in the test.
  fire(): void {
    this.callback([]);
  }
}

let observers: WidthObserver[] = [];

function Probe({ onRender }: { onRender: (zoom: UseZoomResult) => void }) {
  onRender(useZoom());
  return null;
}

function mount(props: Record<string, unknown> = {}) {
  let instance: DocxEditorInstance | null = null;
  let zoom: UseZoomResult | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
      {...props}
    >
      <DocxEditorViewport>
        <Probe
          onRender={(next) => {
            zoom = next;
          }}
        />
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const scroll = view.container.querySelector('[data-testid="docx-editor-scroll"]') as HTMLElement;
  Object.defineProperty(scroll, 'clientWidth', { get: () => viewportWidth, configurable: true });
  return {
    view,
    scroll,
    editor: () => instance!,
    zoom: () => zoom!,
    async resize(width: number) {
      viewportWidth = width;
      await act(async () => {
        for (const observer of [...observers]) observer.fire();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    },
  };
}

beforeEach(() => {
  viewportWidth = 1600;
  observers = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = WidthObserver;
});

afterEach(cleanup);

describe('useZoom', () => {
  test('reports the resolved scale AND where it came from', () => {
    const mounted = mount();
    expect(mounted.zoom().zoom).toBe(1);
    expect(mounted.zoom().isFit).toBe(true);
    expect(mounted.zoom().mode).toEqual({ type: 'fit', fit: 'pageWidth', minZoom: 0.5, maxZoom: 1 });
  });

  test('a level ends the fit; auto goes back to it', async () => {
    const mounted = mount();

    await act(async () => mounted.zoom().setZoom(1.5));
    expect(mounted.zoom().zoom).toBe(1.5);
    expect(mounted.zoom().isFit).toBe(false);

    await act(async () => mounted.zoom().auto());
    expect(mounted.zoom().isFit).toBe(true);
  });

  test('reset returns a fitted editor to a plain 100%', async () => {
    const mounted = mount();
    await act(async () => mounted.zoom().fitToWidth());
    expect(mounted.zoom().isFit).toBe(true);

    await act(async () => mounted.zoom().reset());

    expect(mounted.zoom().isFit).toBe(false);
    expect(mounted.zoom().zoom).toBe(1);
  });

  test('the steppers walk the same ladder the toolbar shows', async () => {
    const mounted = mount();
    expect(mounted.zoom().levels).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);

    await act(async () => mounted.zoom().zoomIn());
    expect(mounted.zoom().zoom).toBe(1.25);

    await act(async () => mounted.zoom().zoomOut());
    expect(mounted.zoom().zoom).toBe(1);
  });

  // The scale a fit lands on is rarely a rung. Stepping from it has to reach the next rung
  // rather than refuse because the current value is not on the ladder.
  test('stepping out of a fitted, off-ladder scale lands on a rung', async () => {
    const mounted = mount();
    await act(async () => mounted.zoom().fitToWidth());
    await mounted.resize(700);
    const fitted = mounted.zoom().zoom;
    expect(fitted).toBeLessThan(1);
    expect(mounted.zoom().canZoomIn).toBe(true);

    await act(async () => mounted.zoom().zoomIn());

    expect([0.5, 0.75, 1, 1.25, 1.5, 2]).toContain(mounted.zoom().zoom);
    expect(mounted.zoom().isFit).toBe(false);
  });

  test('a host prop opens in the mode it asks for', () => {
    const mounted = mount({ zoomMode: { type: 'fixed' } });
    expect(mounted.zoom().isFit).toBe(false);
  });
});

describe('the navigation pane under a fit', () => {
  // Without this the two chase each other every frame: a partial shift narrows the page,
  // which widens the gutter, which asks for a smaller shift, which widens the page again.
  test('docks fully instead of taking the proportional shift', () => {
    const input = { viewportWidth: 1000, pageWidthPx: 816, reservation: 328 };

    // At a fixed scale the page is centred in a shrinking box, so the shift is proportional
    // once there is enough gutter to work with.
    expect(navigationShift({ ...input, pageWidthPx: 620 })).toBe(276);
    // Under a fit the same measurement resolves to the reservation, which is a fixed point.
    expect(navigationShift({ ...input, pageWidthPx: 620, docked: true })).toBe(328);
  });

  test('a gutter already wide enough still moves nothing, fit or not', () => {
    const input = { viewportWidth: 1600, pageWidthPx: 816, reservation: 328 };
    expect(navigationShift(input)).toBe(0);
    expect(navigationShift({ ...input, docked: true })).toBe(0);
  });

  // The predicate is "the fit is BINDING", not "a fit mode is selected". The default `'auto'`
  // is capped at 100% and rests AT that cap on any container with room for the sheet, where
  // the page is a fixed width and the proportional branch is exactly right. Reading the mode
  // alone docked those containers too and pushed the page up to 128px past what the pane
  // needed.
  test('a fit resting at its cap is not docked, so the page moves only as far as it must', () => {
    const mounted = mount();
    expect(mounted.zoom().zoom).toBe(1);
    expect(mounted.zoom().isFit).toBe(true);

    // 1400px viewport, Letter page at 100%: gutter 292 against a 328 reservation.
    const capped = { viewportWidth: 1400, pageWidthPx: 816, reservation: 328 };
    expect(navigationShift(capped)).toBe(72);
    expect(navigationShift({ ...capped, docked: true })).toBe(328);
  });
});
