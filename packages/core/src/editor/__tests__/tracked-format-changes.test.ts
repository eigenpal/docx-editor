// Suggesting mode records formatting as `w:rPrChange` / `w:pPrChange` (fixes #495).
//
// Content had a tracked form and formatting did not: typing wrapped in `w:ins`, deleting
// wrapped in `w:del`, and a Bold press rewrote the run's `w:rPr` outright. Reject had nothing
// to reject, the review pane showed nothing, and — once formatting learned to reach tracked
// text (#493) — a suggester's Bold press silently rewrote another author's pending insertion.
//
// These tests pin the write half. `resolveRevisions` already owned the read half: accept
// drops the record, reject restores what it holds.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { revisionItemsOf } from '../../store/store/review-reads.ts';
import { docx } from './paginated-surface-fixtures.ts';

const AUTHOR = 'Bea';

function withSuggesting(
  body: string,
  run: (surface: PaginatedSurface) => void,
  author: string = AUTHOR
): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    editingMode: 'suggest',
    author,
    revisionDisplayMode: 'all-markup',
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

function select(surface: PaginatedSurface, start: number, end: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

function findAll(node: OoxmlNode, localName: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.localName === localName) found.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return found;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** The property names a change wrapper recorded, in order. */
function recorded(wrapper: OoxmlNode): string[] {
  if (wrapper.kind === 'textValue') return [];
  const inner = wrapper.children.find(
    (child) =>
      child.kind !== 'textValue' && (child.localName === 'rPr' || child.localName === 'pPr')
  );
  if (!inner || inner.kind === 'textValue') return [];
  return inner.children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.localName]));
}

function rPrChanges(surface: PaginatedSurface): OoxmlNode[] {
  return findAll(surface.session.part().root, 'rPrChange');
}

/** Only the records on RUNS — the paragraph mark writes one of its own beside them. */
function runRPrChanges(surface: PaginatedSurface): OoxmlNode[] {
  return findAll(surface.session.part().root, 'r').flatMap((run) => findAll(run, 'rPrChange'));
}

/** Resolve one revision through the surface's own gated path, as a reviewer would. */
function resolve(surface: PaginatedSurface, action: 'accept' | 'reject', node: OoxmlNode): void {
  const id = attributeOf(node, 'id')!;
  const author = attributeOf(node, 'author')!;
  const date = attributeOf(node, 'date');
  // The whole triple: `sameRevision` compares the date too, so an address that drops it
  // matches nothing.
  const revision = date === undefined ? { id, author } : { id, author, date };
  const result = surface.applyAutomationOps(() => [
    action === 'accept'
      ? { op: 'acceptRevision' as const, revision }
      : { op: 'rejectRevision' as const, revision },
  ]);
  if (result.rejected) throw new Error(String(result.reason));
}

const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('tracked format changes in suggesting mode', () => {
  test('bold over plain text records the run properties it replaced', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      // One on the run, one on the paragraph MARK: a whole-paragraph format writes both.
      expect(rPrChanges(surface)).toHaveLength(2);
      const onRun = runRPrChanges(surface)[0]!;
      expect(attributeOf(onRun, 'author')).toBe(AUTHOR);
      expect(attributeOf(onRun, 'id')).toBeDefined();
      // The run had nothing authored, so the record is an empty `w:rPr` — which is what
      // Reject must restore it to.
      expect(recorded(onRun)).toEqual([]);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('the record holds the ORIGINAL bag, not the run as it looked a press ago', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.toggleRunProperty('b');
        select(surface, 0, 5);
        surface.toggleRunProperty('i');
        const onRun = runRPrChanges(surface);
        // Two presses, ONE record — `CT_RPr` admits a single `w:rPrChange` — and it still
        // holds the state before the first press. Recording the intermediate state would
        // make Reject restore a document nobody ever saw.
        expect(onRun).toHaveLength(1);
        expect(recorded(onRun[0]!)).toEqual(['color']);
      }
    );
  });

  test('a write that lands back on the original drops the record', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: '00FF00' });
        expect(runRPrChanges(surface)).toHaveLength(1);
        select(surface, 0, 5);
        surface.setRunProperty('color', { val: 'FF0000' });
        // Back at the original: a card offering to revert a change that no longer exists is
        // worse than no card, because accepting and rejecting it produce the same document.
        expect(runRPrChanges(surface)).toHaveLength(0);
      }
    );
  });

  test('formatting inside the author OWN insertion writes no record', () => {
    // The whole run is already this author's proposal: rejecting the insertion takes the
    // words and the formatting together, so a second card would decide nothing.
    const ins = `<w:ins w:id="9" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z">${textRun('mine')}</w:ins>`;
    withSuggesting(`<w:p>${ins}</w:p>`, (surface) => {
      select(surface, 0, 4);
      surface.toggleRunProperty('b');
      expect(runRPrChanges(surface)).toHaveLength(0);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('formatting inside ANOTHER author insertion records the change', () => {
    // The sting the #494 review found: the press now applies, so without a record it
    // permanently rewrote a foreign pending insertion with nothing to accept or reject.
    const ins = `<w:ins w:id="9" w:author="Ada" w:date="2026-01-01T00:00:00Z">${textRun('theirs')}</w:ins>`;
    withSuggesting(`<w:p>${ins}</w:p>`, (surface) => {
      select(surface, 0, 6);
      surface.toggleRunProperty('b');
      const onRun = runRPrChanges(surface);
      expect(onRun).toHaveLength(1);
      expect(attributeOf(onRun[0]!, 'author')).toBe(AUTHOR);
      // Ada's insertion is untouched — her card still stands beside the new one.
      expect(findAll(surface.session.part().root, 'ins')).toHaveLength(1);
    });
  });

  test('rejecting the format change restores the properties it recorded', () => {
    withSuggesting(
      `<w:p>${textRun('hello', '<w:rPr><w:color w:val="FF0000"/></w:rPr>')}</w:p>`,
      (surface) => {
        select(surface, 0, 5);
        surface.toggleRunProperty('b');
        for (const change of [...rPrChanges(surface)]) resolve(surface, 'reject', change);
        expect(rPrChanges(surface)).toHaveLength(0);
        select(surface, 0, 5);
        expect(surface.formatting().bold).toBe(false);
        expect(surface.formatting().color).toBe('FF0000');
      }
    );
  });

  test('accepting the format change keeps the new properties and drops the record', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      for (const change of [...rPrChanges(surface)]) resolve(surface, 'accept', change);
      expect(rPrChanges(surface)).toHaveLength(0);
      select(surface, 0, 5);
      expect(surface.formatting().bold).toBe(true);
    });
  });

  test('the change reaches the review queue as a `format` revision', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const items = revisionItemsOf(surface.session.part());
      const formats = items.filter((item) => item.revisionKind === 'format');
      expect(formats.length).toBeGreaterThan(0);
      expect(formats[0]!.author).toBe(AUTHOR);
    });
  });

  test('a paragraph property change writes w:pPrChange over CT_PPrBase', () => {
    withSuggesting(`<w:p>${textRun('hello')}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.setParagraphProperty('jc', { val: 'center' });
      const changes = findAll(surface.session.part().root, 'pPrChange');
      expect(changes).toHaveLength(1);
      expect(attributeOf(changes[0]!, 'author')).toBe(AUTHOR);
      // `CT_PPrChange` records a `CT_PPrBase`, which cannot hold `w:rPr` or `w:sectPr` — so
      // the mark and any section break stay on the container and out of the record.
      expect(recorded(changes[0]!)).not.toContain('rPr');
      expect(recorded(changes[0]!)).not.toContain('sectPr');
    });
  });

  test('editing mode writes the properties with no record at all', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(`<w:p>${textRun('hello')}</w:p>`));
    if (!opened.ok) throw new Error(opened.reason);
    try {
      select(opened.surface, 0, 5);
      opened.surface.toggleRunProperty('b');
      expect(rPrChanges(opened.surface)).toHaveLength(0);
      expect(opened.surface.formatting().bold).toBe(true);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });
});
