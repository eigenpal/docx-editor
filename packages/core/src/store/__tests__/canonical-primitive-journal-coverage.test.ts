// Complete-journal coverage for every authorable TreeDocOp kind (tasks 3.6 and 3.8).

import { describe, expect, test } from 'bun:test';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import { isHeaderFooterLifecycleOp } from '../package/hf-lifecycle.ts';
import { isNoteLifecycleOp } from '../package/note-lifecycle.ts';
import { applyTreeOp, TREE_DOC_OP_KINDS, type TreeDocOp } from '../store/tree-ops.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { authorableCoverageFixtures } from './canonical-primitive-journal-coverage-ops.ts';
import {
  captureOneJournal,
  openStore,
  replayAndCompare,
} from './canonical-primitive-journal-coverage-support.ts';

const fixtures = authorableCoverageFixtures();

function dummyPart() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function isUnsupportedKind(kind: (typeof TREE_DOC_OP_KINDS)[number]): boolean {
  try {
    const applied = applyTreeOp(dummyPart(), { op: kind, controlId: 'missing' } as TreeDocOp);
    return !applied.ok && applied.reason === 'unsupported';
  } catch {
    return false;
  }
}

describe('canonical primitive journal completeness (tasks 3.6 and 3.8)', () => {
  test('every authorable TREE_DOC_OP_KINDS member has a coverage fixture', () => {
    const covered = new Set(fixtures.map((fixture) => fixture.kind));
    expect(covered.size).toBe(fixtures.length);
    for (const kind of TREE_DOC_OP_KINDS) {
      if (isUnsupportedKind(kind)) continue;
      expect(covered.has(kind)).toBe(true);
    }
    expect(TREE_DOC_OP_KINDS.filter((kind) => isUnsupportedKind(kind))).toEqual([
      'addRepeatingSectionItem',
      'removeRepeatingSectionItem',
    ]);
  });

  test('repeating-section kinds refuse with no journal and no revision move', () => {
    const store = openStore(fixtures[0]!.bytes);
    const journals: unknown[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const before = store.packageRevision;
    for (const kind of TREE_DOC_OP_KINDS.filter((entry) => isUnsupportedKind(entry))) {
      const result = store.transact({ kind: 'body' }, (context) => {
        context.apply({ op: kind, controlId: 'missing' } as TreeDocOp);
      });
      expect(result.ok).toBe(false);
    }
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(0);
    expect(store.packageRevision).toBe(before);
  });

  for (const fixture of fixtures) {
    const path = isHeaderFooterLifecycleOp({ op: fixture.kind })
      ? 'lifecycle'
      : isNoteLifecycleOp({ op: fixture.kind })
        ? 'lifecycle'
        : 'transact';
    test(`${fixture.kind} journal replays to an equivalent replica (${path})`, () => {
      const first = openStore(fixture.bytes);
      const second = openStore(fixture.bytes);
      const replica = openStore(fixture.bytes);
      const captured = captureOneJournal(first, () => fixture.apply(first));
      expect(captured.result.ok).toBe(true);
      if (!captured.result.ok) throw new Error(captured.result.reason ?? fixture.kind);
      expect(captured.journal).not.toBeNull();
      const again = captureOneJournal(second, () => fixture.apply(second));
      expect(JSON.stringify(again.journal)).toBe(JSON.stringify(captured.journal));
      replayAndCompare(replica, first, captured.journal!);
    });
  }
});
