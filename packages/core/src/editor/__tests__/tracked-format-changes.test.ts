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

  test('rejecting a format change leaves a pending paragraph-mark decision standing', () => {
    // The mark's own `w:ins` lives in the same `w:pPr/w:rPr` the format record sits in, and
    // it is somebody's pending decision about the BREAK. Restoring the container from the
    // record alone deleted it, so rejecting a formatting suggestion silently answered an
    // unrelated one.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const onMark = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPrChange')
      );
      expect(onMark).toHaveLength(1);
      // The record does NOT carry Ada's mark insertion.
      expect(recorded(onMark[0]!)).not.toContain('ins');
      for (const change of [...rPrChanges(surface)]) resolve(surface, 'reject', change);
      // Ada's decision is still there to answer.
      const marks = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'ins')
      );
      expect(marks).toHaveLength(1);
      expect(attributeOf(marks[0]!, 'author')).toBe('Ada');
    });
  });

  test('rejecting a Word-written mark record does not double the mark revision', () => {
    // `CT_ParaRPrOriginal` admits `w:ins`, so a record another producer wrote legitimately
    // carries one. Keeping the live mark AND the recorded copy emits two `w:ins` in a
    // container whose schema allows one — a `w:pPr` Word reports as unreadable.
    const doubled =
      '<w:p><w:pPr><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '<w:b/>' +
      '<w:rPrChange w:id="5" w:author="Cy" w:date="2026-01-02T00:00:00Z"><w:rPr>' +
      '<w:ins w:id="4" w:author="Ada" w:date="2026-01-01T00:00:00Z"/>' +
      '</w:rPr></w:rPrChange>' +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(doubled, (surface) => {
      const change = findAll(surface.session.part().root, 'rPrChange')[0]!;
      resolve(surface, 'reject', change);
      const markProperties = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPr')
      )[0]!;
      const names = (markProperties as { children: OoxmlNode[] }).children.map((child) =>
        child.kind === 'textValue' ? '' : child.localName
      );
      expect(names.filter((name) => name === 'ins')).toHaveLength(1);
      expect(names).not.toContain('b');
    });
  });

  test('a mark this author proposed adding takes no record of its own', () => {
    // Rejecting that `w:ins` runs the paragraph into the next one and takes the mark's
    // properties with it, so a record of what they used to be decides nothing.
    const marked =
      '<w:p><w:pPr><w:rPr>' +
      `<w:ins w:id="4" w:author="${AUTHOR}" w:date="2026-01-01T00:00:00Z"/>` +
      '</w:rPr></w:pPr>' +
      textRun('hello') +
      '</w:p>';
    withSuggesting(marked, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      const onMark = findAll(surface.session.part().root, 'pPr').flatMap((pPr) =>
        findAll(pPr, 'rPrChange')
      );
      expect(onMark).toHaveLength(0);
      // The RUN still records: its words are not this author's.
      expect(runRPrChanges(surface)).toHaveLength(1);
    });
  });

  test('a wide format mints one distinct id per record', () => {
    // The transaction lends its formatting ops ONE id minter, because `nextRevisionId` walks
    // the whole part and formatting emits an op per run. A minter that handed the same id
    // twice would make two changes one card in the review pane.
    const runs = [
      textRun('one ', '<w:rPr><w:color w:val="FF0000"/></w:rPr>'),
      textRun('two ', '<w:rPr><w:color w:val="00FF00"/></w:rPr>'),
      textRun('three', '<w:rPr><w:color w:val="0000FF"/></w:rPr>'),
    ].join('');
    withSuggesting(`<w:p>${runs}</w:p>`, (surface) => {
      select(surface, 0, 'one two three'.length);
      surface.toggleRunProperty('b');
      const ids = rPrChanges(surface).map((change) => attributeOf(change, 'id'));
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      // Each record still holds its own run's colour, not the first run's.
      expect(runRPrChanges(surface).map((change) => recorded(change))).toEqual([
        ['color'],
        ['color'],
        ['color'],
      ]);
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
