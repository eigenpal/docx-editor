// Run formatting over tracked-change text (fixes #493).
//
// Runs inside a revision wrapper (`w:ins` / `w:del` / `w:moveFrom` / `w:moveTo`) have
// offsets — `segmentsOf` descends into the wrapper — but the edit-planning walks stopped at
// the wrapper node. The plan came back empty, so Bold, font and size changes over tracked
// text emitted no ops at all, silently. These tests pin the walks descending: the surface
// lane (`surface-formatting.ts`) through the toolbar path, and the store lane
// (`direct-properties.ts`) directly.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { runPropertyEdits, runsCovering, type OoxmlNode } from '@docx-editor.dev/core/store';
import { docx } from './paginated-surface-fixtures.ts';

function withSurface(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const ins = (runs: string) =>
  `<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">${runs}</w:ins>`;
const textRun = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function firstParagraphNode(surface: PaginatedSurface): OoxmlNode {
  const found = findFirst(
    surface.session.part().root,
    (candidate) => candidate.kind === 'paragraph'
  );
  if (!found) throw new Error('no paragraph');
  return found;
}

function findFirst(node: OoxmlNode, match: (node: OoxmlNode) => boolean): OoxmlNode | null {
  if (match(node)) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findFirst(child, match);
    if (found) return found;
  }
  return null;
}

/** Every run under `node`, each as its authored `w:rPr` names plus its text, in order. */
function runShapes(node: OoxmlNode): { props: string[]; text: string; tracked: boolean }[] {
  const shapes: { props: string[]; text: string; tracked: boolean }[] = [];
  const walk = (current: OoxmlNode, tracked: boolean): void => {
    if (current.kind === 'textValue') return;
    if (current.kind === 'run') {
      const rPr = current.children.find((child) => child.kind === 'runProperties');
      const props =
        rPr && rPr.kind !== 'textValue'
          ? rPr.children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.localName]))
          : [];
      let text = '';
      const collect = (inner: OoxmlNode): void => {
        if (inner.kind === 'textValue') text += inner.value;
        else for (const grand of inner.children) collect(grand);
      };
      collect(current);
      shapes.push({ props, text, tracked });
      return;
    }
    const inside = tracked || current.kind === 'revisionInsert';
    for (const child of current.children) walk(child, inside);
  };
  walk(node, false);
  return shapes;
}

function select(surface: PaginatedSurface, start: number, end: number): void {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

describe('run formatting over tracked-change text', () => {
  test('bold applies to a run inside w:ins and keeps it tracked', () => {
    withSurface(`<w:p>${ins(textRun('hello'))}</w:p>`, (surface) => {
      select(surface, 0, 5);
      expect(surface.formatting().bold).toBe(false);
      surface.toggleRunProperty('b');
      expect(surface.formatting().bold).toBe(true);
      expect(runShapes(firstParagraphNode(surface))).toEqual([
        { props: ['b'], text: 'hello', tracked: true },
      ]);
    });
  });

  test('formatting part of a tracked run splits it inside the wrapper', () => {
    withSurface(`<w:p>${ins(textRun('hello world'))}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.toggleRunProperty('b');
      expect(runShapes(firstParagraphNode(surface))).toEqual([
        { props: ['b'], text: 'hello', tracked: true },
        { props: [], text: ' world', tracked: true },
      ]);
    });
  });

  test('a selection mixing plain and tracked runs formats both', () => {
    withSurface(`<w:p>${textRun('plain ')}${ins(textRun('tracked'))}</w:p>`, (surface) => {
      select(surface, 0, 'plain tracked'.length);
      surface.toggleRunProperty('b');
      expect(runShapes(firstParagraphNode(surface))).toEqual([
        { props: ['b'], text: 'plain ', tracked: false },
        { props: ['b'], text: 'tracked', tracked: true },
      ]);
    });
  });

  test('font size applies over a tracked insertion', () => {
    withSurface(`<w:p>${ins(textRun('hello'))}</w:p>`, (surface) => {
      select(surface, 0, 5);
      surface.setRunProperty('sz', { val: '48' });
      expect(surface.formatting().fontSizeHalfPoints).toBe(48);
      expect(runShapes(firstParagraphNode(surface))).toEqual([
        { props: ['sz'], text: 'hello', tracked: true },
      ]);
    });
  });

  test('pending caret formatting reads the tracked run to the left', () => {
    // `authoredRunPropertiesAt` walks the same surface; a caret inside a tracked bold run
    // must arm over that run's bag rather than the paragraph mark's.
    withSurface(
      `<w:p>${ins('<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>')}</w:p>`,
      (surface) => {
        select(surface, 4, 4);
        expect(surface.formatting().bold).toBe(true);
      }
    );
  });

  test('a selection across a tracked deletion leaves the deleted runs alone', () => {
    // The deletion's runs are hidden in the default display mode but keep offsets, so the
    // write must skip them: restyling text the user cannot see surfaces only when the
    // deletion is rejected. Display-mode-aware inclusion is #497.
    const del =
      '<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:delText xml:space="preserve">XYZ</w:delText></w:r></w:del>';
    withSurface(`<w:p>${textRun('abc')}${del}${textRun('def')}</w:p>`, (surface) => {
      select(surface, 0, 'abcXYZdef'.length);
      surface.toggleRunProperty('b');
      expect(runShapes(firstParagraphNode(surface))).toEqual([
        { props: ['b'], text: 'abc', tracked: false },
        { props: [], text: 'XYZ', tracked: false },
        { props: ['b'], text: 'def', tracked: false },
      ]);
    });
  });

  test('the store lane plans no edits over a tracked deletion', () => {
    const del =
      '<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:delText xml:space="preserve">XYZ</w:delText></w:r></w:del>';
    withSurface(`<w:p>${del}</w:p>`, (surface) => {
      const part = surface.session.part();
      const id = surface.session.paragraphIds()[0]!;
      expect(runPropertyEdits(part, id, 0, 3, { localName: 'b' })).toEqual([]);
      expect(runsCovering(part, id, 0, 3)).toHaveLength(0);
    });
  });

  test('the store lane plans edits and covers runs inside w:ins', () => {
    withSurface(`<w:p>${ins(textRun('hello'))}</w:p>`, (surface) => {
      const part = surface.session.part();
      const id = surface.session.paragraphIds()[0]!;
      const edits = runPropertyEdits(part, id, 0, 5, { localName: 'b' });
      expect(edits).toEqual([{ start: 0, end: 5, properties: [{ localName: 'b' }] }]);
      expect(runsCovering(part, id, 0, 5)).toHaveLength(1);
    });
  });
});
