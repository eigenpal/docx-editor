/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review pane on a container too narrow to hold a rail.
//
// Reserving a 316px gutter out of a 420px viewport made the document unreadable in order to
// show the comments. Below a threshold the gutter goes back to the page and the cards move
// into an overlay drawer, opened by the same toolbar button as everywhere else.
//
// What is pinned here is the difference between the two presentations, not the cards
// themselves — those are `review-sidebar.test.tsx`'s job and are unchanged.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

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
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx(
  '<w:p><w:r><w:t>hello </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">' +
    '<w:r><w:t>added text</w:t></w:r></w:ins></w:p>'
);

// happy-dom lays nothing out, so the width that decides rail-or-drawer has to be supplied.
let viewportWidth = 1600;
let observers: { fire: () => void }[] = [];

class WidthObserver {
  constructor(private readonly callback: (entries: unknown[]) => void) {
    observers.push(this);
  }
  observe(): void {}
  disconnect(): void {
    observers = observers.filter((entry) => entry !== this);
  }
  // An empty entry list, not no argument: the rail measures its own cards through a second
  // observer that iterates what it is handed, and calling it bare throws inside the component.
  fire(): void {
    this.callback([]);
  }
}

async function mount(width: number) {
  viewportWidth = width;
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      modules={[reviewModule()]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const scroll = view.container.querySelector('[data-testid="docx-editor-scroll"]') as HTMLElement;
  Object.defineProperty(scroll, 'clientWidth', { get: () => viewportWidth, configurable: true });
  await act(async () => {
    for (const observer of [...observers]) observer.fire();
  });
  return { view, scroll, editor: () => instance! };
}

beforeEach(() => {
  observers = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = WidthObserver;
});

afterEach(cleanup);

describe('a container wide enough for a rail', () => {
  test('keeps the anchored column and its gutter', async () => {
    const { view, scroll } = await mount(1600);

    expect(view.getByTestId('review-rail').getAttribute('data-layout')).toBe('rail');
    expect(scroll.getAttribute('data-review-layout')).toBe('rail');
    expect(view.queryByTestId('review-drawer')).toBeNull();
  });
});

describe('a container too narrow for a rail', () => {
  test('gives the gutter back and mounts a drawer', async () => {
    const { view, scroll } = await mount(600);

    expect(view.getByTestId('review-rail').getAttribute('data-layout')).toBe('drawer');
    // The stylesheet keys the `padding-right: 0` rule off this, which is what lets the fit
    // hand the width back to the document.
    expect(scroll.getAttribute('data-review-layout')).toBe('drawer');
    expect(view.getByTestId('review-drawer')).toBeDefined();
  });

  // An anchored card in a drawer points at text the drawer is covering, which is worse than
  // not pointing at all.
  test('stacks its cards in document order with no anchor', async () => {
    const { view } = await mount(600);

    const list = view.container.querySelector('.docx-review__list') as HTMLElement;
    expect(list.hasAttribute('data-flow')).toBe(true);
    for (const slot of view.container.querySelectorAll<HTMLElement>('.docx-review__slot')) {
      expect(slot.style.position).toBe('');
      expect(slot.style.top).toBe('');
    }
  });

  test('drops the marker strip — the toolbar button is the way in', async () => {
    const { view, editor } = await mount(600);
    await act(async () => {
      editor().exec({ type: 'toggleReviewPane' });
    });
    expect(editor().isReviewPaneOpen()).toBe(false);

    expect(view.queryAllByTestId('review-marker')).toHaveLength(0);
  });

  test('is dialog-shaped, with a scrim only while it is open', async () => {
    const { view, editor } = await mount(600);
    const drawer = view.getByTestId('review-drawer');

    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.hasAttribute('hidden')).toBe(false);
    expect(view.getByTestId('review-scrim')).toBeDefined();

    await act(async () => {
      editor().exec({ type: 'toggleReviewPane' });
    });

    // Hidden and inert, NOT unmounted: a half-typed reply has to survive a dismissal.
    expect(drawer.hasAttribute('hidden')).toBe(true);
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(view.queryByTestId('review-scrim')).toBeNull();
  });

  test('Escape closes it', async () => {
    const { view, editor } = await mount(600);
    expect(editor().isReviewPaneOpen()).toBe(true);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(editor().isReviewPaneOpen()).toBe(false);
    expect(view.getByTestId('review-drawer').hasAttribute('hidden')).toBe(true);
  });

  test('the close button closes it', async () => {
    const { view, editor } = await mount(600);

    await act(async () => {
      view.getByLabelText('Close comments').click();
    });

    expect(editor().isReviewPaneOpen()).toBe(false);
  });

  test('tapping the scrim closes it', async () => {
    const { view, editor } = await mount(600);

    await act(async () => {
      fireEvent.pointerDown(view.getByTestId('review-scrim'));
    });

    expect(editor().isReviewPaneOpen()).toBe(false);
  });
});
