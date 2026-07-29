// The React and Vue paginated hosts behave identically (tasks 11.1, 11.2).
//
// Both adapters mount the SAME engine surface, so anything a user can do is already decided
// by the engine. What these assert is the part that could still diverge: that each host is
// thin — it mounts once, tears down exactly once, survives a re-render without losing the
// document, and exposes the same commands under the same names.
//
// Written as one file driving both, rather than two files that happen to look alike: a
// paired test that lives in one package drifts the moment someone edits only that package.

// MUST be first: registration happens on import, before Vue's runtime-dom is evaluated.
import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { createElement, type Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { zipSync, strToU8 } from 'fflate';
import type { App } from 'vue';
import {
  PaginatedDocxEditor as ReactHost,
  type PaginatedDocxEditorHandle,
} from '../src/components/PaginatedDocxEditor.tsx';
import type { PaginatedDocxEditorExpose } from '../../vue/src/components/PaginatedDocxEditor.ts';

// Vue's DOM runtime captures `document` when its MODULE loads, and ESM hoists every import
// above the registration statement above — so importing it statically bound it to a null
// document and every mount threw. Loaded here instead, once the DOM exists.
const { createApp, ref: vueRef, h: vueH, nextTick } = await import('vue');
const { PaginatedDocxEditor: VueHost } = await import(
  '../../vue/src/components/PaginatedDocxEditor.ts'
);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
const BROKEN = new Uint8Array([1, 2, 3, 4]);

/** Mount the React host and hand back its handle plus a teardown. */
function mountReact(source: Uint8Array, onError?: (reason: string) => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const handle: { current: PaginatedDocxEditorHandle | null } = { current: null };
  act(() => {
    root.render(
      createElement(ReactHost, {
        source,
        scale: 1,
        ref: handle as unknown as Ref<PaginatedDocxEditorHandle>,
        ...(onError ? { onError } : {}),
      })
    );
  });
  return {
    container,
    handle,
    rerender: () =>
      act(() => {
        root.render(
          createElement(ReactHost, {
            source,
            scale: 1,
            ref: handle as unknown as Ref<PaginatedDocxEditorHandle>,
            // A NEW callback identity every render, which is what a parent normally does.
            onStateChange: () => {},
          })
        );
      }),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Mount the Vue host and hand back its exposed api plus a teardown. */
function mountVue(source: Uint8Array, onError?: (reason: string) => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = vueRef<PaginatedDocxEditorExpose | null>(null);
  const app: App = createApp({
    render: () =>
      vueH(VueHost, {
        source,
        scale: 1,
        ref: handle,
        ...(onError ? { onError } : {}),
      }),
  });
  app.mount(container);
  return {
    container,
    handle,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

const surfaceOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-paginated-surface');

describe('each host mounts the engine surface and nothing more (task 11.1)', () => {
  test('React paints pages and reports the revision', () => {
    const mounted = mountReact(SOURCE);
    const surface = surfaceOf(mounted.container)!;
    expect(surface).not.toBeNull();
    expect(surface.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    expect(surface.dataset.pageCount).not.toBe('0');
    mounted.unmount();
  });

  test('Vue paints pages and reports the revision', async () => {
    const mounted = mountVue(SOURCE);
    const surface = surfaceOf(mounted.container)!;
    expect(surface).not.toBeNull();
    // The PAINTED pages are the engine's own DOM and appear synchronously. The reported
    // counts are framework state, and Vue propagates those on the next tick where React's
    // `act` flushes them — a difference in when, not in what.
    expect(surface.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    await nextTick();
    expect(surface.dataset.pageCount).not.toBe('0');
    mounted.unmount();
  });

  test('both paint the SAME page count for the same document', async () => {
    // The engine decides pagination; an adapter that produced a different answer would be
    // doing layout work it has no business doing.
    const react = mountReact(SOURCE);
    const vue = mountVue(SOURCE);
    await nextTick();
    expect(surfaceOf(vue.container)!.querySelectorAll('.docx-page').length).toBe(
      surfaceOf(react.container)!.querySelectorAll('.docx-page').length
    );
    expect(surfaceOf(vue.container)!.dataset.pageCount).toBe(
      surfaceOf(react.container)!.dataset.pageCount
    );
    react.unmount();
    vue.unmount();
  });

  test('both expose the same command surface, under the same names', () => {
    const react = mountReact(SOURCE);
    const vue = mountVue(SOURCE);
    const reactKeys = Object.keys(react.handle.current ?? {}).sort();
    const vueKeys = Object.keys(vue.handle.value ?? {}).sort();
    expect(vueKeys).toEqual(reactKeys);
    expect(reactKeys.length).toBeGreaterThan(5);
    react.unmount();
    vue.unmount();
  });
});

describe('editing through the exposed commands is identical (task 11.2)', () => {
  test('typing through the handle reaches the document in both', () => {
    const react = mountReact(SOURCE);
    const vue = mountVue(SOURCE);
    react.handle.current!.selectAll();
    react.handle.current!.type('X');
    vue.handle.value!.selectAll();
    vue.handle.value!.type('X');
    // Compared by SAVED BYTES, which is the artefact that actually ships.
    expect(vue.handle.value!.save()).toEqual(react.handle.current!.save());
    react.unmount();
    vue.unmount();
  });

  test('undo returns both to the same document', () => {
    const react = mountReact(SOURCE);
    const vue = mountVue(SOURCE);
    const original = react.handle.current!.save();
    for (const handle of [react.handle.current!, vue.handle.value!]) {
      handle.selectAll();
      handle.type('replaced');
      handle.undo();
    }
    expect(react.handle.current!.save()).toEqual(original);
    expect(vue.handle.value!.save()).toEqual(original);
    react.unmount();
    vue.unmount();
  });
});

describe('lifecycle: the hosts are thin (tasks 11.1, 11.2)', () => {
  test('a React re-render with new callbacks does NOT remount the surface', () => {
    // Remounting would reopen the document and drop the caret on every parent render — the
    // reason the callbacks are held in refs rather than listed as effect dependencies.
    const mounted = mountReact(SOURCE);
    const before = surfaceOf(mounted.container)!.querySelector('.docx-page');
    mounted.rerender();
    expect(surfaceOf(mounted.container)!.querySelector('.docx-page')).toBe(before);
    mounted.unmount();
  });

  test('unmounting removes the painted surface in both', () => {
    const react = mountReact(SOURCE);
    react.unmount();
    expect(document.querySelectorAll('.docx-page').length).toBe(0);

    const vue = mountVue(SOURCE);
    vue.unmount();
    expect(document.querySelectorAll('.docx-page').length).toBe(0);
  });

  test('a rejected document is REPORTED, not thrown, in both', () => {
    // A corrupt upload must not take the surrounding application down with it.
    const reactErrors: string[] = [];
    const react = mountReact(BROKEN, (reason) => reactErrors.push(reason));
    expect(reactErrors.length).toBe(1);
    react.unmount();

    const vueErrors: string[] = [];
    const vue = mountVue(BROKEN, (reason) => vueErrors.push(reason));
    expect(vueErrors).toEqual(reactErrors);
    vue.unmount();
  });
});
