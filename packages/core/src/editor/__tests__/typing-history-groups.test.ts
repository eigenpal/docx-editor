// A typing run is one undo step however slowly it is typed. Every keystroke here lands in
// its own task, the way real typing does, so each one is its own type-buffer flush and its
// own transaction; the grouping under test is what keeps them one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/index.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, mount as mountFixture, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const opened = mountFixture(body);
  mounted.push(opened);
  return opened;
}

afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
  document.getSelection()?.removeAllRanges();
});

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Type `text` one key per task, so every key is its own flush. */
async function typeSlowly(container: HTMLElement, text: string): Promise<void> {
  for (const data of text) {
    container.querySelector('.docx-pages')!.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data,
      })
    );
    await nextTask();
  }
}

function undoTrail(surface: PaginatedSurface, steps: number): string[] {
  const trail: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    surface.undo();
    trail.push(surface.session.bodyText());
  }
  return trail;
}

describe('typing history groups', () => {
  test('keys typed in separate tasks undo and redo as one step', async () => {
    const { surface, container } = mount(paragraph('tail'));
    putCaret(surface, 0);
    const revisionBefore = surface.state().revision;
    await typeSlowly(container, 'One, two. ');
    // Each key is still its own transaction: grouping changes history, not publication.
    expect(surface.state().revision).toBe(revisionBefore + 10);
    expect(surface.session.bodyText()).toBe('One, two. tail');

    surface.undo();
    expect(surface.session.bodyText()).toBe('tail');
    expect(surface.state().selection.head.offset).toBe(0);
    surface.redo();
    expect(surface.session.bodyText()).toBe('One, two. tail');
    expect(surface.state().selection.head.offset).toBe(10);
  });

  test('a caret move starts a new step', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'Hello');
    putCaret(surface, 3);
    await typeSlowly(container, 'XY');
    expect(surface.session.bodyText()).toBe('HelXYlo');
    expect(undoTrail(surface, 2)).toEqual(['Hello', '']);
  });

  test('a caret that leaves and comes back still starts a new step', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'Hello');
    putCaret(surface, 0);
    putCaret(surface, 5);
    await typeSlowly(container, ' world');
    expect(surface.session.bodyText()).toBe('Hello world');
    expect(undoTrail(surface, 2)).toEqual(['Hello', '']);
  });

  test('a caret echo at the same position keeps the run open', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'ab');
    putCaret(surface, 2);
    await typeSlowly(container, 'cd');
    expect(undoTrail(surface, 1)).toEqual(['']);
  });

  test('each Backspace is its own step, and typing after it starts a new one', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'Hello there');
    surface.deleteBackward();
    surface.deleteBackward();
    surface.deleteBackward();
    await typeSlowly(container, 'ir');
    expect(surface.session.bodyText()).toBe('Hello thir');
    expect(undoTrail(surface, 5)).toEqual([
      'Hello th',
      'Hello the',
      'Hello ther',
      'Hello there',
      '',
    ]);
  });

  test('each forward Delete is its own step', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'Hello there');
    putCaret(surface, 8);
    surface.deleteForward();
    surface.deleteForward();
    expect(surface.session.bodyText()).toBe('Hello the');
    expect(undoTrail(surface, 3)).toEqual(['Hello thre', 'Hello there', '']);
  });

  test('a long run with spaces and punctuation is still one step', async () => {
    const { surface, container } = mount(paragraph(''));
    const sentence = 'The cat sat on the mat, and then it ran away to sleep.';
    await typeSlowly(container, sentence);
    expect(surface.session.bodyText()).toBe(sentence);
    expect(undoTrail(surface, 1)).toEqual(['']);
  });

  test('Enter is its own step between two typing runs', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'First');
    surface.splitParagraph();
    await typeSlowly(container, 'Second');
    expect(surface.session.paragraphIds()).toHaveLength(2);
    surface.undo();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(surface.session.bodyText()).not.toContain('Second');
    surface.undo();
    expect(surface.session.paragraphIds()).toHaveLength(1);
    expect(surface.session.bodyText()).toBe('First');
    surface.undo();
    expect(surface.session.bodyText()).toBe('');
  });

  test('typing over a selection is one step with the text typed after it', async () => {
    const { surface, container } = mount(paragraph('Hello'));
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 3 },
    });
    await typeSlowly(container, 'XY');
    expect(surface.session.bodyText()).toBe('HelXY');
    expect(undoTrail(surface, 1)).toEqual(['Hello']);
  });

  test('a typing format armed at the caret ends the run', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'Ab');
    surface.toggleRunProperty('b');
    await typeSlowly(container, 'cd');
    expect(surface.session.bodyText()).toBe('Abcd');
    expect(undoTrail(surface, 2)).toEqual(['Ab', '']);
  });

  test('typing after an undo starts a new step', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'ab');
    surface.undo();
    await typeSlowly(container, 'cd');
    surface.undo();
    expect(surface.session.bodyText()).toBe('');
    surface.redo();
    expect(surface.session.bodyText()).toBe('cd');
  });

  test('a direct type() call is its own step, not part of the keyboard run', async () => {
    const { surface, container } = mount(paragraph(''));
    await typeSlowly(container, 'ab');
    surface.type('XY');
    await typeSlowly(container, 'cd');
    expect(surface.session.bodyText()).toBe('abXYcd');
    expect(undoTrail(surface, 3)).toEqual(['abXY', 'ab', '']);
  });

  test('tracked typing groups the same way and leaves one insertion', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(paragraph('tail')), {
      scale: 1,
      author: 'Ada',
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      surface.setEditingMode('suggest');
      putCaret(surface, 0);
      await typeSlowly(container, 'new ');
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml.match(/<w:ins\b/g)).toHaveLength(1);
      surface.undo();
      expect(serializeOoxmlPart(surface.session.part())).not.toContain('<w:ins');
      expect(surface.session.bodyText()).toBe('tail');
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
