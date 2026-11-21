// The copy, cut and paste refusals that adapters show: one call per refused event, with the
// event's own reason, from the pages and from a drawing selection overlay.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { forwardClipboardEvents } from '../chrome-clipboard.ts';
import {
  clipboardCommandRefusal,
  shownClipboardRefusal,
  watchClipboardRefusals,
  type ClipboardRefusal,
} from '../clipboard-refusal-display.ts';
import { CHART_CLIPBOARD_REASON } from '../clipboard-object-selection.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import {
  GROUP_MEMBER_CLIPBOARD_REASON,
  SHAPE_PASTE_TEXT_REASON,
  TEXT_BOX_PICTURE_PASTE_REASON,
} from '../surface-drawing-clipboard.ts';
import { GROUP } from './shape-selection-fixture.ts';
import {
  PNG,
  SHAPE,
  TEXT_BOX,
  body,
  editors,
  open,
  selectFirstDrawing,
} from './drawing-paste-fixture.ts';

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** A bubbling clipboard event that carries `flavours`. */
function clipboardEvent(type: string, flavours: Record<string, string> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (kind: string) => flavours[kind] ?? '',
      setData: () => undefined,
      types: Object.keys(flavours),
      items: [],
    },
  });
  return event;
}

const textPaste = () => clipboardEvent('paste', { 'text/plain': 'ZULU' });

async function watched(markup: string) {
  const opened = await open(markup);
  const shown: ClipboardRefusal[] = [];
  const stop = watchClipboardRefusals(opened.container, opened.editor, (refusal) =>
    shown.push(refusal)
  );
  const pages = opened.container.querySelector<HTMLElement>('.docx-pages')!;
  return { ...opened, shown, stop, pages };
}

describe('watchClipboardRefusals', () => {
  test('a paste on the pages over a shape with no text shows its reason once', async () => {
    const { editor, shown, pages, stop } = await watched(body(SHAPE));
    selectFirstDrawing(editor);
    pages.dispatchEvent(textPaste());
    expect(shown).toEqual([{ action: 'paste', reason: SHAPE_PASTE_TEXT_REASON }]);
    stop();
  });

  test('an earlier refusal never shows again for a later paste that lands', async () => {
    const { editor, shown, pages, stop } = await watched(body(SHAPE));
    selectFirstDrawing(editor);
    pages.dispatchEvent(textPaste());
    expect(shown).toHaveLength(1);
    // The rejection stays in the snapshot, but this paste published none.
    expect(editor.snapshot().lastRejection).not.toBeNull();
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
    pages.dispatchEvent(textPaste());
    pages.dispatchEvent(clipboardEvent('copy'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(shown).toHaveLength(1);
    stop();
  });

  test('a paste with a picture on a selected text box shows its reason', async () => {
    const { editor, shown, pages, stop } = await watched(body(TEXT_BOX));
    selectFirstDrawing(editor);
    const src = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    const html = `<p>Look <img src="${src}" width="10" height="10"></p>`;
    pages.dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Look', 'text/html': html }));
    expect(shown).toEqual([{ action: 'paste', reason: TEXT_BOX_PICTURE_PASTE_REASON }]);
    stop();
  });

  test('the selection overlay shows its refusal, inside the mount or inside the pages', async () => {
    const { editor, container, shown, pages, stop } = await watched(body(SHAPE));
    selectFirstDrawing(editor);
    const outside = document.createElement('div');
    container.append(outside);
    const unforward = forwardClipboardEvents(outside, editor);
    outside.dispatchEvent(textPaste());
    expect(shown).toEqual([{ action: 'paste', reason: SHAPE_PASTE_TEXT_REASON }]);
    unforward();

    // An overlay inside the pages stops the event there, so the refusal reads on the next task.
    const inside = document.createElement('div');
    pages.append(inside);
    const unforwardInside = forwardClipboardEvents(inside, editor);
    inside.dispatchEvent(textPaste());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(shown).toHaveLength(2);
    unforwardInside();
    stop();
  });

  test('a copy of a shape inside a group shows the copy reason', async () => {
    const { editor, surface, shown, pages, stop } = await watched(body(GROUP));
    const group = selectFirstDrawing(editor);
    const shapes: string[] = [];
    const visit = (node: OoxmlNode) => {
      if (node.kind === 'textValue') return;
      if ((node as { localName?: string }).localName === 'wsp') shapes.push(node.id);
      node.children.forEach(visit);
    };
    visit(findNode(surface.session.part(), group)!);
    expect(surface.selectDrawingMember(shapes[0]!)).toBe(true);
    pages.dispatchEvent(clipboardEvent('copy'));
    expect(shown).toEqual([{ action: 'copy', reason: GROUP_MEMBER_CLIPBOARD_REASON }]);
    stop();
  });

  test('after stop, a refused paste shows nothing', async () => {
    const { editor, shown, pages, stop } = await watched(body(SHAPE));
    selectFirstDrawing(editor);
    stop();
    pages.dispatchEvent(textPaste());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(shown).toEqual([]);
  });
});

describe('clipboardCommandRefusal', () => {
  test('a refused paste command gives its action and reason', async () => {
    const { editor } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const command = { type: 'pasteWithoutFormatting', text: 'ZULU' } as const;
    expect(clipboardCommandRefusal(command, editor.exec(command))).toEqual({
      action: 'paste',
      reason: SHAPE_PASTE_TEXT_REASON,
    });
  });

  test('success, other commands, and refusals in text show nothing', () => {
    const refused = (reason: string) => ({ ok: false, code: 'unsupported', reason }) as const;
    expect(clipboardCommandRefusal({ type: 'copy' }, { ok: true, changed: false })).toBeNull();
    expect(clipboardCommandRefusal({ type: 'undo' }, refused(SHAPE_PASTE_TEXT_REASON))).toBeNull();
    expect(
      clipboardCommandRefusal({ type: 'paste', text: 'x' }, refused('a locked control'))
    ).toBeNull();
    expect(clipboardCommandRefusal({ type: 'cut' }, refused(CHART_CLIPBOARD_REASON))).toEqual({
      action: 'cut',
      reason: CHART_CLIPBOARD_REASON,
    });
  });

  test('shownClipboardRefusal keeps only the drawing and chart clipboard sentences', () => {
    expect(shownClipboardRefusal(SHAPE_PASTE_TEXT_REASON)).toBe(SHAPE_PASTE_TEXT_REASON);
    expect(shownClipboardRefusal('unsupported-content')).toBeNull();
    expect(shownClipboardRefusal(null)).toBeNull();
  });
});
