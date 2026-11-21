import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { lay, load, para } from './table-row-keep-fixtures.ts';

// A pass that converges with the previous layout reuses the checkpoints after the join. A
// line added before the join moves their line counters too.
test('checkpoints after a convergence keep the line count of a fresh pass', () => {
  const body =
    para('Grow', 2) +
    para('Next', 1, { pageBreakBefore: true }) +
    para('More', 3) +
    para('Last', 1, { pageBreakBefore: true });
  const part = load(body);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  const first = (part.root.children.find((n) => n.kind === 'body') as OoxmlElement).children[0]!;
  const edited = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: first.id,
    offset: 0,
    text: 'words that wrap onto another line of the first page ',
  });
  if (!edited.ok) throw Error(edited.reason);
  lay(edited.part, 15, { session, cache });
  expect(session.stats.reusedPages).toBeGreaterThan(0);
  const cold = createLayoutSession();
  lay(edited.part, 15, { session: cold });
  expect(session.endLineCounter).toBe(cold.endLineCounter);
  expect(session.checkpoints.map((mark) => mark.lineCounter)).toEqual(
    cold.checkpoints.map((mark) => mark.lineCounter)
  );
});
