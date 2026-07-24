// Shared DOM input helpers for binding integration tests (interactive-paginated 4.5).

import type { EditSurface } from '../src/index.ts';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';

/** Monospace 16px pre layout used by mockPmLayout for PM posAtCoords during drag/drop. */
const MOCK_CHAR_WIDTH_PX = 8;

const KEY_CODE_BY_KEY: Readonly<Record<string, number>> = {
  ArrowLeft: 37,
  ArrowRight: 39,
  ArrowUp: 38,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  Backspace: 8,
  Delete: 46,
  Enter: 13,
  Escape: 27,
};

export function pmDom(parent: HTMLElement): HTMLElement {
  const el = parent.querySelector('[data-docx-input-host-mount] [contenteditable="true"]');
  if (!(el instanceof HTMLElement)) throw new Error('ProseMirror contenteditable not found');
  return el;
}

function findPrimaryTextNode(root: HTMLElement): Text | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

/** Map a client X coordinate to a grapheme offset in the contenteditable text. */
function mockOffsetAtClientX(dom: HTMLElement, x: number): number {
  const text = dom.textContent ?? '';
  const box = dom.getBoundingClientRect();
  const localX = Math.max(0, x - box.left);
  return Math.max(0, Math.min(text.length, Math.round(localX / MOCK_CHAR_WIDTH_PX)));
}

export function mockPmLayout(dom: HTMLElement): void {
  dom.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 400,
      height: 24,
      right: 400,
      bottom: 24,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  dom.style.width = '400px';
  dom.style.height = '24px';
  dom.style.font = '16px monospace';
  dom.style.whiteSpace = 'pre';

  const doc = dom.ownerDocument;
  doc.elementFromPoint = (x: number, y: number) => {
    const box = dom.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return dom;
    return null;
  };
  doc.caretPositionFromPoint = (x: number, y: number) => {
    const textNode = findPrimaryTextNode(dom);
    if (!textNode) return null;
    return { offsetNode: textNode, offset: mockOffsetAtClientX(dom, x) };
  };
  doc.caretRangeFromPoint = (x: number, y: number) => {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = doc.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.setEnd(pos.offsetNode, pos.offset);
    return range;
  };
}

export function dispatchBeforeInput(target: HTMLElement, inputType: string, data?: string | null): InputEvent {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: data ?? null,
  });
  target.dispatchEvent(event);
  return event;
}

export function dispatchPaste(target: HTMLElement, plain: string, html?: string): ClipboardEvent {
  const dt = new DataTransfer();
  dt.setData('text/plain', plain);
  if (html) dt.setData('text/html', html);
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  target.dispatchEvent(event);
  return event;
}

export function dispatchCut(target: HTMLElement): ClipboardEvent {
  const event = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
  target.dispatchEvent(event);
  return event;
}

export function dispatchCopy(target: HTMLElement): ClipboardEvent {
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
  target.dispatchEvent(event);
  return event;
}

export function dispatchKey(
  target: HTMLElement,
  key: string,
  opts: { metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {},
): KeyboardEvent {
  const keyCode = KEY_CODE_BY_KEY[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode,
    which: keyCode,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

/** ProseMirror `Mod-` resolves to Ctrl in happy-dom (non-Mac platform string). */
export function dispatchModKey(target: HTMLElement, key: string, shift = false): KeyboardEvent {
  return dispatchKey(target, key, { ctrlKey: true, shiftKey: shift });
}

export function patchDragEvent(event: DragEvent, x: number, y: number, dt: DataTransfer, ctrlKey = false): DragEvent {
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'ctrlKey', { value: ctrlKey });
  return event;
}

export function dispatchInternalDrag(
  target: HTMLElement,
  opts: { fromX: number; toX: number; y?: number; copy?: boolean },
): void {
  mockPmLayout(target);
  const y = opts.y ?? 12;
  const copy = opts.copy ?? false;
  target.dispatchEvent(patchDragEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }), opts.fromX, y, new DataTransfer(), copy));
  target.dispatchEvent(patchDragEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }), opts.toX, y, new DataTransfer(), copy));
  target.dispatchEvent(patchDragEvent(new DragEvent('drop', { bubbles: true, cancelable: true }), opts.toX, y, new DataTransfer(), copy));
}

/** Sync semantic selection then focus with frame identity (authorizes input). */
export function authorizeFocus(surface: EditSurface, selection: SemanticSelection): void {
  const synced = surface.syncSemanticSelection({ frameId: selection.frameId, selection });
  if (!synced.ok) throw new Error(`semantic sync failed: ${synced.reason}`);
  const outcome = surface.focus({ frameId: selection.frameId });
  if (!outcome.ok) throw new Error(`focus failed: ${outcome.reason}`);
}

export function dispatchHistoryUndo(target: HTMLElement): void {
  dispatchBeforeInput(target, 'historyUndo');
}
