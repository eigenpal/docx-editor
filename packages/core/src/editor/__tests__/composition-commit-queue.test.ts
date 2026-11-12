// COMPOSED TEXT COMMITS AFTER THE FRAME THAT SHOWS IT.
//
// A plain composed insertion at the caret is queued at `compositionend` and lands in the first
// task after the next paint, as one undo step, the way batched typing lands. These tests pin
// when it lands early (anything that reads or moves the selection or the text), that the order
// of what was entered holds, and which compositions still commit at once.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { afterNextPaint } from '../surface-composition-commit.ts';
import { mount as mountDetached, putCaret } from './paginated-surface-fixtures.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
  document.getSelection()?.removeAllRanges();
});

/** Mounted in the document, so the browser selection the input method writes at exists. */
function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const opened = mountDetached(body);
  document.body.append(opened.container);
  mounted.push(opened);
  putCaret(opened.surface, 0);
  return opened;
}

function compositionEvent(type: string, data = ''): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data, configurable: true });
  return event;
}

const pagesOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.docx-pages')!;

/**
 * One composition the way a browser drives it: each step replaces the composing string in the
 * text node the caret is in (or the selected text in it), then `input` fires.
 */
function compose(pages: HTMLElement, steps: readonly string[], committed = steps.at(-1)!): void {
  pages.dispatchEvent(compositionEvent('compositionstart'));
  const selection = document.getSelection()!;
  const node = selection.focusNode as Text;
  const start = Math.min(selection.anchorOffset, selection.focusOffset);
  const end = Math.max(selection.anchorOffset, selection.focusOffset);
  const head = node.data.slice(0, start);
  const tail = node.data.slice(end);
  for (const step of steps) {
    pages.dispatchEvent(compositionEvent('compositionupdate', step));
    node.data = head + step + tail;
    selection.setBaseAndExtent(node, start + step.length, node, start + step.length);
    pages.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: step })
    );
  }
  pages.dispatchEvent(compositionEvent('compositionend', committed));
}

function keystroke(container: HTMLElement, data: string): void {
  pagesOf(container).dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    })
  );
}

/** The first task after the next frame, where queued composed text lands. */
async function nextPaintTask(): Promise<void> {
  await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  for (let index = 0; index < 3; index += 1) await new Promise((done) => setTimeout(done, 0));
}

function select(surface: PaginatedSurface, from: number, to: number): void {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

describe('afterNextPaint', () => {
  function fakeTimers() {
    const timeouts = new Map<number, { run: () => void; ms: number }>();
    const frames = new Map<number, () => void>();
    let next = 1;
    return {
      timeouts,
      frames,
      setTimeout: (run: () => void, ms = 0) => (timeouts.set(next, { run, ms }), next++),
      clearTimeout: (id: number | undefined) => void timeouts.delete(id!),
      requestAnimationFrame: (run: () => void) => (frames.set(next, run), next++),
      cancelAnimationFrame: (id: number) => void frames.delete(id),
    };
  }

  test('runs in a task queued from the next frame, not in the frame', () => {
    const timers = fakeTimers();
    const ran: string[] = [];
    afterNextPaint(timers as never, () => ran.push('task'));
    expect(ran).toEqual([]);
    const [frame] = [...timers.frames.values()];
    frame!();
    // The fallback is gone; the task waits in a zero-delay timeout behind the paint.
    expect(ran).toEqual([]);
    expect([...timers.timeouts.values()].map((timeout) => timeout.ms)).toEqual([0]);
    [...timers.timeouts.values()][0]!.run();
    expect(ran).toEqual(['task']);
  });

  test('a window that paints nothing still runs the task, once', () => {
    const timers = fakeTimers();
    const ran: string[] = [];
    afterNextPaint(timers as never, () => ran.push('task'));
    const [fallback] = [...timers.timeouts.values()];
    expect(fallback!.ms).toBe(100);
    fallback!.run();
    expect(ran).toEqual(['task']);
    expect(timers.frames.size).toBe(0);
  });
});

describe('a composed syllable', () => {
  test('is queued at compositionend and lands after the next paint as one undo step', async () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    const revision = surface.state().revision;
    compose(pagesOf(container), ['ㅇ', '아']);
    expect(surface.session.bodyText()).toBe('우리나라 ');
    expect(surface.state().revision).toBe(revision);
    expect(pagesOf(container).textContent).toContain('우리나라 아');
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('우리나라 아');
    expect(surface.state().selection.head.offset).toBe(6);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });

  test('typed text after a queued syllable lands after it', async () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    keystroke(container, '!');
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('우리나라 아!');
  });

  test('a selection move lands it first, where it was composed', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    select(surface, 0, 0);
    expect(surface.session.bodyText()).toBe('우리나라 아');
    expect(surface.state().selection.head.offset).toBe(0);
  });

  test('a command lands it first: Backspace deletes the syllable', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    surface.deleteBackward();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });

  test('undo lands it first, then undoes it', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    compose(pagesOf(container), ['ㅇ', '아']);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
    surface.redo();
    expect(surface.session.bodyText()).toBe('우리나라 아');
  });

  test('chained syllables each start over the queued text and stay one undo step each', () => {
    const { surface, container } = mount(paragraph('우리나라 '));
    putCaret(surface, 5);
    const pages = pagesOf(container);
    compose(pages, ['ㅇ', '아']);
    compose(pages, ['ㄹ', '르', '름']);
    compose(pages, ['ㄷ', '다']);
    expect(surface.session.bodyText()).toBe('우리나라 ');
    surface.flushPendingInput();
    expect(surface.session.bodyText()).toBe('우리나라 아름다');
    expect(surface.state().selection.head.offset).toBe(8);
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 아름');
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 아');
    surface.undo();
    expect(surface.session.bodyText()).toBe('우리나라 ');
  });
});

describe('compositions that still commit at once', () => {
  test('a candidate that replaces selected text', () => {
    const { surface, container } = mount(paragraph('かんじを'));
    select(surface, 0, 3);
    compose(pagesOf(container), ['漢字']);
    // Not a plain insertion at a collapsed caret: no queue, the model holds it now.
    expect(surface.session.bodyText()).toBe('漢字を');
    surface.undo();
    expect(surface.session.bodyText()).toBe('かんじを');
  });

  test('a candidate composed at the caret queues like a syllable', async () => {
    const { surface, container } = mount(paragraph('を'));
    putCaret(surface, 0);
    compose(pagesOf(container), ['か', 'かん', 'かんじ', '漢字']);
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('漢字を');
    surface.undo();
    expect(surface.session.bodyText()).toBe('を');
  });

  test('a dead key composes its accented letter', async () => {
    const { surface, container } = mount(paragraph('word'));
    putCaret(surface, 4);
    compose(pagesOf(container), ['´', 'é']);
    await nextPaintTask();
    expect(surface.session.bodyText()).toBe('wordé');
  });
});
