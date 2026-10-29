/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * What makes a paragraph's text read differently while the text itself is unchanged: a mark
 * that arrives late (`paragraph-text-marks.ts`), or a deletion record that arrives or that an
 * undo withdraws (`paragraph-text-deletions.ts`). Those paragraphs read again.
 */
import type * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { InlineIndex } from './paragraph-inline-index.ts';
import { textDeletionsOf } from './paragraph-text-deletions.ts';
import { textMarksOf } from './paragraph-text-marks.ts';

export interface TextReadsHost {
  readonly inline: InlineIndex;
  /** Whether a bulk load is running: it reads everything once at its end. */
  readonly loading: () => boolean;
  /** Tell the registry's listeners which paragraphs read again. */
  readonly changed: (ids: ReadonlySet<LogicalId>) => void;
}

/**
 * Read paragraphs again when their marks or deletions change. Returns the unsubscribe.
 *
 * Both indexes tell their listeners while a transaction calls its observers. One transaction
 * can change both, as an undo or redo that marks restored text and records or withdraws its
 * deletion does, so the texts are collected and each one is read once, after both have told.
 */
export function subscribeTextReads(doc: Y.Doc, host: TextReadsHost): () => void {
  const marks = textMarksOf(doc);
  const deletions = textDeletionsOf(doc);
  let pending: Set<Y.Text> | 'all' | null = null;
  const collect = (texts: ReadonlySet<Y.Text> | 'all'): void => {
    if (host.loading()) return;
    if (texts === 'all' || pending === 'all') {
      pending = 'all';
      return;
    }
    pending ??= new Set();
    for (const text of texts) pending.add(text);
  };
  // Registered after both indexes, which register theirs when they are first read above.
  const flush = (): void => {
    const texts = pending;
    pending = null;
    if (texts === null || host.loading()) return;
    const ids = host.inline.marksChanged(texts === 'all' ? host.inline.allTexts() : texts);
    if (ids.size > 0) host.changed(ids);
  };
  const stopMarks = marks.subscribe(collect);
  const stopDeletions = deletions.subscribe((runs) => collect(marks.textsReading(runs)));
  doc.on('beforeObserverCalls', flush);
  return () => {
    stopMarks();
    stopDeletions();
    doc.off('beforeObserverCalls', flush);
  };
}
