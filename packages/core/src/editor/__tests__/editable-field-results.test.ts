// Editing inside saved field results (`fieldResults: 'editable'`).
//
// A field that shows its saved result (DATE, MERGEFIELD, HYPERLINK display text) accepts typing,
// deletion, and selection inside the result. The offsets just before and after the result are
// outside the field. Backspace after a field and Delete before one select the whole field
// first, and a selection with one end inside a result grows to cover the field. Live fields
// stay one unit, and the default mode does not change at all.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { PaginatedSurfaceOptions } from '../paginated-surface-contract.ts';
import { COLLABORATION_FIELD_RESULTS_REFUSAL } from '../field-results-scope.ts';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const complex = (instruction: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}">${result}</w:fldSimple>`;

const MERGE = complex(' MERGEFIELD Name ', run('Name'));
/** `ab ` + field + ` cd`: the result starts at offset 3 in the editable mode. */
const paragraphWith = (field: string) => `<w:p>${run('ab ')}${field}${run(' cd')}</w:p>`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
  document.getSelection()?.removeAllRanges();
});

function open(body: string, options: PaginatedSurfaceOptions = { fieldResults: 'editable' }) {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(body), { scale: 1, ...options });
  if (!result.ok) throw new Error(result.reason);
  const surface = result.surface;
  mounted.push({ surface, container });
  const paragraphId = surface.session.paragraphIds()[0]!;
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  return {
    surface,
    pages,
    paragraphId,
    caret(offset: number) {
      const point = { paragraphId, offset };
      surface.setSelection({ anchor: point, head: point });
    },
    select(anchor: number, head: number) {
      surface.setSelection({
        anchor: { paragraphId, offset: anchor },
        head: { paragraphId, offset: head },
      });
    },
    /** The paragraph as the editable mode addresses it. */
    text: () => paragraphTextOf(surface.session.part(), paragraphId, { fieldResults: 'editable' }),
    xml: () => serializeOoxmlPart(surface.session.part()),
    offsets: () => {
      const { anchor, head } = surface.state().selection;
      return [anchor.offset, head.offset];
    },
  };
}

/** Text between the field's `separate` and `end` markers in the saved part. */
function resultTextOf(xml: string): string {
  const separate = xml.indexOf('w:fldCharType="separate"');
  const end = xml.indexOf('w:fldCharType="end"');
  return [...xml.slice(separate, end).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join('');
}

const press = (pages: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  pages.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  );

describe('typing inside a saved result', () => {
  test('a character typed inside the result lands in the result runs', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(5);
    host.surface.type('X');
    expect(host.text()).toBe('ab NaXme cd');
    expect(resultTextOf(host.xml())).toBe('NaXme');
    expect(host.offsets()).toEqual([6, 6]);
  });

  test('typing at either edge of the result lands outside the field', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(7);
    host.surface.type('!');
    host.caret(3);
    host.surface.type('?');
    expect(host.text()).toBe('ab ?Name! cd');
    expect(resultTextOf(host.xml())).toBe('Name');
  });

  test('a keystroke burst through beforeinput is one undo step', async () => {
    const host = open(paragraphWith(MERGE));
    host.caret(5);
    for (const data of 'XYZ') {
      host.pages.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data,
        })
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.text()).toBe('ab NaXYZme cd');
    host.surface.undo();
    expect(host.text()).toBe('ab Name cd');
    host.surface.redo();
    expect(host.text()).toBe('ab NaXYZme cd');
  });

  test('a simple field becomes a complex field with the edit in its result', () => {
    const host = open(paragraphWith(simple(' MERGEFIELD Name ', run('Name'))));
    host.caret(4);
    host.surface.type('X');
    expect(host.text()).toBe('ab NXame cd');
    expect(host.xml()).not.toContain('fldSimple');
    expect(resultTextOf(host.xml())).toBe('NXame');
    host.surface.undo();
    expect(host.xml()).toContain('fldSimple');
  });

  test('typing in suggesting mode tracks the insertion inside the result', () => {
    const host = open(paragraphWith(MERGE), {
      fieldResults: 'editable',
      editingMode: 'suggest',
      author: 'Reviewer',
    });
    host.caret(5);
    host.surface.type('X');
    const xml = host.xml();
    const separate = xml.indexOf('w:fldCharType="separate"');
    const end = xml.indexOf('w:fldCharType="end"');
    const insertion = xml.indexOf('<w:ins ');
    expect(insertion).toBeGreaterThan(separate);
    expect(insertion).toBeLessThan(end);
  });
});

describe('deletion at and inside a saved result', () => {
  for (const input of ['surface', 'keyboard'] as const) {
    test(`${input} Backspace after the field selects it, then removes it`, () => {
      const host = open(paragraphWith(MERGE));
      host.caret(7);
      const backspace = () =>
        input === 'surface' ? host.surface.deleteBackward() : press(host.pages, 'Backspace');
      backspace();
      expect(host.text()).toBe('ab Name cd');
      expect(host.offsets()).toEqual([3, 7]);
      backspace();
      expect(host.text()).toBe('ab  cd');
      expect(host.xml()).not.toContain('fldChar');
      host.surface.undo();
      expect(host.text()).toBe('ab Name cd');
      expect(host.xml()).toContain('fldChar');
    });

    test(`${input} Delete before the field selects it`, () => {
      const host = open(paragraphWith(MERGE));
      host.caret(3);
      if (input === 'surface') host.surface.deleteForward();
      else press(host.pages, 'Delete');
      expect(host.text()).toBe('ab Name cd');
      expect(host.offsets()).toEqual([3, 7]);
    });
  }

  test('Backspace and Delete inside the result edit its characters', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(5);
    host.surface.deleteBackward();
    expect(host.text()).toBe('ab Nme cd');
    host.surface.deleteForward();
    expect(host.text()).toBe('ab Ne cd');
    expect(resultTextOf(host.xml())).toBe('Ne');
  });
});

describe('selection across a field boundary', () => {
  test('a range from before the field into the result grows to the field end', () => {
    const host = open(paragraphWith(MERGE));
    host.select(1, 5);
    expect(host.offsets()).toEqual([1, 7]);
  });

  test('a range from inside the result past the field grows to the field start', () => {
    const host = open(paragraphWith(MERGE));
    host.select(5, 9);
    expect(host.offsets()).toEqual([3, 9]);
    host.select(9, 5);
    expect(host.offsets()).toEqual([9, 3]);
  });

  test('a range inside the result, edges included, stays as it is', () => {
    const host = open(paragraphWith(MERGE));
    host.select(4, 6);
    expect(host.offsets()).toEqual([4, 6]);
    host.select(3, 5);
    expect(host.offsets()).toEqual([3, 5]);
  });

  test('Shift+Arrow out of the result grows the selection over the field', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(5);
    for (let index = 0; index < 3; index += 1) press(host.pages, 'ArrowRight', { shiftKey: true });
    const [anchor, head] = host.offsets();
    expect(anchor).toBe(3);
    expect(head).toBe(8);
  });

  test('deleting a grown selection removes the whole field', () => {
    const host = open(paragraphWith(MERGE));
    host.select(1, 5);
    host.surface.deleteBackward();
    expect(host.text()).toBe('a cd');
    expect(host.xml()).not.toContain('fldChar');
  });
});

describe('the whole field and its result text', () => {
  test('deleting the result text selected by hand keeps an empty field', () => {
    const host = open(paragraphWith(MERGE));
    host.select(3, 7);
    host.surface.deleteBackward();
    expect(host.text()).toBe('ab  cd');
    expect(host.xml()).toContain('MERGEFIELD');
    expect(resultTextOf(host.xml())).toBe('');
  });

  test('typing over a field selected by Backspace replaces the field', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(7);
    host.surface.deleteBackward();
    host.surface.type('X');
    expect(host.text()).toBe('ab X cd');
    expect(host.xml()).not.toContain('MERGEFIELD');
  });

  test('a moved selection forgets the selected field', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(7);
    host.surface.deleteBackward();
    host.select(4, 6);
    host.select(3, 7);
    host.surface.deleteBackward();
    expect(host.xml()).toContain('MERGEFIELD');
  });

  test('removing a selected field in suggesting mode tracks the whole field', () => {
    const host = open(paragraphWith(MERGE), {
      fieldResults: 'editable',
      editingMode: 'suggest',
      author: 'Reviewer',
    });
    host.caret(7);
    host.surface.deleteBackward();
    host.surface.deleteBackward();
    const xml = host.xml();
    const deletion = xml.indexOf('<w:del ');
    expect(deletion).toBeGreaterThan(-1);
    expect(deletion).toBeLessThan(xml.indexOf('w:fldCharType="begin"'));
    expect(xml).toContain('MERGEFIELD');
  });
});

describe('field shading', () => {
  test('a caret inside a multi-run result shades every piece of the result', () => {
    const host = open(paragraphWith(complex(' MERGEFIELD Name ', run('Na') + run('me'))));
    host.caret(4);
    const pieces = [...host.pages.querySelectorAll<HTMLElement>('[data-field-result-start]')];
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.classList.contains('docx-field-atom--active')).toBe(true);
    }
    host.caret(1);
    for (const piece of pieces) {
      expect(piece.classList.contains('docx-field-atom--active')).toBe(false);
    }
  });
});

describe('composition inside a saved result', () => {
  test('text an IME writes into the result lands in the result runs', () => {
    const host = open(paragraphWith(MERGE));
    host.caret(5);
    host.pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const spans = [...host.pages.querySelectorAll<HTMLElement>('[data-start]')].filter(
      (span) =>
        span.dataset.paragraphId === host.paragraphId &&
        Number(span.dataset.start) <= 5 &&
        Number(span.dataset.end) >= 5
    );
    const span = spans[0]!;
    const at = 5 - Number(span.dataset.start);
    span.textContent = `${span.textContent!.slice(0, at)}\u4e2d${span.textContent!.slice(at)}`;
    host.pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(host.surface.state().lastRejection).toBeNull();
    expect(host.text()).toBe('ab Na\u4e2dme cd');
    expect(resultTextOf(host.xml())).toBe('Na\u4e2dme');
  });
});

describe('fields that stay one unit', () => {
  test('a live field is one unit in the editable mode', () => {
    const host = open(paragraphWith(complex(' PAGE ', run('7'))));
    expect(host.text()).toBe(`ab ￼ cd`);
    host.caret(4);
    host.surface.type('X');
    expect(host.text()).toBe(`ab ￼X cd`);
  });

  test('the default mode keeps a saved-result field one unit', () => {
    const host = open(paragraphWith(MERGE), {});
    expect(paragraphTextOf(host.surface.session.part(), host.paragraphId)).toBe(`ab ￼ cd`);
    host.caret(4);
    host.surface.type('X');
    expect(paragraphTextOf(host.surface.session.part(), host.paragraphId)).toBe(`ab ￼X cd`);
    expect(resultTextOf(host.xml())).toBe('Name');
  });
});

describe('collaboration', () => {
  test('an editable request with a collaboration model is refused', () => {
    expect(() =>
      open(paragraphWith(MERGE), {
        fieldResults: 'editable',
        collaborationModel: {} as NonNullable<PaginatedSurfaceOptions['collaborationModel']>,
      })
    ).toThrow(COLLABORATION_FIELD_RESULTS_REFUSAL);
  });

  test('an unknown mode is refused', () => {
    expect(() =>
      open(paragraphWith(MERGE), {
        fieldResults: 'live' as unknown as PaginatedSurfaceOptions['fieldResults'],
      })
    ).toThrow(TypeError);
  });
});
