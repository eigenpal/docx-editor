import { writeOoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { TreePackageStore } from '../store/store/tree-package-store.ts';
import { addComment } from '../store/store/comment-writes.ts';
import { paragraphTextOf } from '../store/store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import { getRunText } from './helpers.ts';
import type { HeadlessCanonicalContext } from './context.ts';
import type { CanonicalRevisionRef } from './revision-bridge.ts';
import { revisionLocalName } from './tracked-reconcile.ts';
import {
  commentDelta,
  flattenParagraphs,
  packagesDeepEqual,
  packagesStructurallyEqual,
} from './legacy-model.ts';
import { legacyOffsetToTreeOffset } from './legacy-offsets.ts';
import { legacyParagraphPlainText, plainTextEdit } from './legacy-text.ts';
import { collectTrackedOps, hasTrackedChangeDelta } from './tracked-reconcile.ts';
import {
  acknowledgeResolutions,
  peekResolutions,
  type RecordedResolution,
} from './resolution-log.ts';
import type { DocxPackage, Endnote, Footnote, Paragraph } from './types.ts';

export { legacyOffsetToTreeOffset } from './legacy-offsets.ts';

import { HeadlessRepackRefusal } from './headless-errors.ts';

function paragraphTextOps(
  part: OoxmlPart,
  paragraphId: string,
  before: string,
  after: string
): TreeDocOp[] {
  const edit = plainTextEdit(before, after);
  if (!edit) return [];
  const start = legacyOffsetToTreeOffset(part, paragraphId, edit.start);
  const end =
    edit.deleteLength === 0
      ? start
      : legacyOffsetToTreeOffset(part, paragraphId, edit.start + edit.deleteLength);
  const ops: TreeDocOp[] = [];
  if (end > start) ops.push({ op: 'deleteText', paragraphId, start, end });
  if (edit.insertText.length > 0) {
    ops.push({ op: 'insertText', paragraphId, offset: start, text: edit.insertText });
  }
  return ops;
}

function collectTextOps(
  ctx: HeadlessCanonicalContext,
  baseline: DocxPackage,
  current: DocxPackage
): TreeDocOp[] | HeadlessRepackRefusal {
  const main = ctx.package.parts.get(ctx.package.mainDocumentPart);
  if (!main) return new HeadlessRepackRefusal('missing-part', 'main document part missing');
  const baseParas = flattenParagraphs(baseline.document);
  const curParas = flattenParagraphs(current.document);
  if (baseParas.length !== curParas.length) {
    return new HeadlessRepackRefusal(
      'unsupported-structural-change',
      'paragraph count changed — structural edits are not supported via legacy repack'
    );
  }
  const ops: TreeDocOp[] = [];
  for (let index = 0; index < baseParas.length; index += 1) {
    const basePara = baseParas[index]!;
    const curPara = curParas[index]!;
    if (basePara.type !== 'paragraph' || curPara.type !== 'paragraph') {
      return new HeadlessRepackRefusal(
        'unsupported-structural-change',
        'block kind changed — only in-place paragraph edits are supported'
      );
    }
    const paragraphId = ctx.paragraphIds[index];
    if (!paragraphId) {
      return new HeadlessRepackRefusal('missing-anchor', `no tree anchor for paragraph ${index}`);
    }
    if (hasTrackedChangeDelta(basePara, curPara)) continue;
    const baseText = legacyParagraphPlainText(basePara);
    const curText = legacyParagraphPlainText(curPara);
    if (baseText === curText) continue;
    try {
      ops.push(...paragraphTextOps(main, paragraphId, baseText, curText));
    } catch (error) {
      if (error instanceof HeadlessRepackRefusal) return error;
      throw error;
    }
  }
  return ops;
}

function noteParagraphs(note: Footnote | Endnote): Paragraph[] {
  return flattenParagraphs({ content: note.content, comments: [] }).filter(
    (block): block is Paragraph => block.type === 'paragraph'
  );
}

function collectNoteTrackedOps(
  ctx: HeadlessCanonicalContext,
  baselineNotes: readonly (Footnote | Endnote)[] | undefined,
  currentNotes: readonly (Footnote | Endnote)[] | undefined,
  noteKind: NoteKind,
  resolvedKeys?: ReadonlySet<string>
): TreeDocOp[] | HeadlessRepackRefusal {
  const partName = noteKind === 'footnote' ? '/word/footnotes.xml' : '/word/endnotes.xml';
  const part = ctx.package.parts.get(partName);
  if (!part) return [];
  const idsByNote =
    noteKind === 'footnote' ? ctx.noteParagraphIds.footnotes : ctx.noteParagraphIds.endnotes;
  const ops: TreeDocOp[] = [];
  for (const currentNote of currentNotes ?? []) {
    const baselineNote = baselineNotes?.find((note) => note.id === currentNote.id);
    if (!baselineNote) {
      return new HeadlessRepackRefusal(
        'unsupported-footnotes',
        `${noteKind} ${currentNote.id} added`
      );
    }
    const paragraphIds = idsByNote.get(currentNote.id) ?? [];
    const baseParas = noteParagraphs(baselineNote);
    const curParas = noteParagraphs(currentNote);
    if (baseParas.length !== curParas.length) {
      return new HeadlessRepackRefusal(
        'unsupported-structural-change',
        `${noteKind} ${currentNote.id} paragraph count changed`
      );
    }
    const noteOps = collectTrackedOps(
      part,
      baseParas,
      curParas,
      paragraphIds,
      resolvedKeys,
      `${noteKind}:${currentNote.id}`
    );
    if (noteOps instanceof HeadlessRepackRefusal) return noteOps;
    ops.push(...noteOps);
  }
  return ops;
}

function resolutionKey(ref: CanonicalRevisionRef): string {
  return `${ref.story.kind === 'body' ? 'body' : `${ref.story.kind}:${ref.story.noteId}`}:${revisionLocalName(ref.type)}:${ref.address.id}:${ref.address.author}:${ref.address.date ?? ''}`;
}

function resolvedKeysFrom(resolutions: readonly RecordedResolution[]): ReadonlySet<string> {
  return new Set(resolutions.map((resolution) => resolutionKey(resolution.ref)));
}

function resolutionOps(resolutions: readonly RecordedResolution[]): TreeDocOp[] {
  const lastByRef = new Map<string, RecordedResolution>();
  for (const resolution of resolutions) {
    lastByRef.set(resolutionKey(resolution.ref), resolution);
  }
  const ops: TreeDocOp[] = [];
  for (const resolution of lastByRef.values()) {
    if (resolution.ref.type === 'insertion' || resolution.ref.type === 'deletion') {
      ops.push({
        op: resolution.mode === 'accept' ? 'acceptRevision' : 'rejectRevision',
        revision: resolution.ref.address,
        localName: revisionLocalName(resolution.ref.type),
      });
      continue;
    }
    ops.push({
      op: resolution.mode === 'accept' ? 'acceptRevision' : 'rejectRevision',
      revision: resolution.ref.address,
    });
  }
  return ops;
}

function storyScopeFor(ref: CanonicalRevisionRef) {
  if (ref.story.kind === 'body') return { kind: 'body' as const };
  return { kind: 'notesPart' as const, noteKind: ref.story.kind };
}

function applyCommentAdds(
  store: TreePackageStore,
  ctx: HeadlessCanonicalContext,
  baseline: DocxPackage,
  current: DocxPackage
): HeadlessRepackRefusal | null {
  const added = commentDelta(baseline.document.comments, current.document.comments);
  for (const comment of added) {
    const index = findParagraphIndexForComment(current, comment.id);
    if (index === null) {
      return new HeadlessRepackRefusal(
        'unsupported-comment',
        `comment ${comment.id} has no paragraph anchor in the legacy model`
      );
    }
    const paragraphId = ctx.paragraphIds[index];
    if (!paragraphId) {
      return new HeadlessRepackRefusal(
        'missing-anchor',
        `no tree anchor for comment paragraph ${index}`
      );
    }
    const text = comment.content
      .flatMap((p) => p.content)
      .filter((r) => r.type === 'run')
      .map((r) => getRunText(r))
      .join('');
    const part = store.bodyStore().part;
    const anchorText = paragraphTextOf(part, paragraphId) ?? '';
    const result = addComment(store.bodyStore(), {
      anchor: { paragraphId, start: 0, end: anchorText.length },
      author: comment.author,
      ...(comment.date ? { date: comment.date } : {}),
      text,
      ...(comment.parentId !== undefined ? { replyToCommentId: String(comment.parentId) } : {}),
    });
    if (!result.ok) {
      return new HeadlessRepackRefusal('unsupported-comment', result.reason);
    }
    store.replacePackageShell(store.bodyStore().package);
  }
  return null;
}

function findParagraphIndexForComment(current: DocxPackage, commentId: number): number | null {
  let index = 0;
  for (const block of current.document.content) {
    if (block.type === 'paragraph') {
      for (const item of block.content) {
        if (item.type === 'commentRangeStart' && item.id === commentId) return index;
      }
      index += 1;
    } else {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) {
            if (cellBlock.type === 'paragraph') {
              for (const item of cellBlock.content) {
                if (item.type === 'commentRangeStart' && item.id === commentId) return index;
              }
              index += 1;
            }
          }
        }
      }
    }
  }
  return null;
}

function applyOps(
  store: TreePackageStore,
  ops: readonly TreeDocOp[]
): HeadlessRepackRefusal | null {
  if (ops.length === 0) return null;
  const result = store.bodyStore().transact((ctx) => {
    for (const op of ops) ctx.apply(op);
  });
  if (!result.ok) {
    return new HeadlessRepackRefusal('apply-failed', result.reason ?? 'tree op rejected');
  }
  return null;
}

function applyStoryOps(
  store: TreePackageStore,
  scope: ReturnType<typeof storyScopeFor>,
  ops: readonly TreeDocOp[]
): HeadlessRepackRefusal | null {
  if (ops.length === 0) return null;
  const result = store.transact(scope, (ctx) => {
    for (const op of ops) ctx.apply(op);
  });
  if (!result.ok) {
    return new HeadlessRepackRefusal('apply-failed', result.reason ?? 'tree op rejected');
  }
  return null;
}

/**
 * Repack a legacy document against its retained canonical context.
 * No-op returns the exact original bytes; supported edits patch the canonical tree only.
 */
export function repackFromCanonicalContext(
  ctx: HeadlessCanonicalContext,
  current: DocxPackage,
  originalBuffer: ArrayBuffer,
  doc?: object
): ArrayBuffer | HeadlessRepackRefusal {
  const pendingResolutions = doc ? peekResolutions(doc) : [];
  if (packagesDeepEqual(ctx.baseline, current) && pendingResolutions.length === 0) {
    return originalBuffer.slice(0);
  }
  if ((ctx.baseline.footnotes?.length ?? 0) !== (current.footnotes?.length ?? 0)) {
    return new HeadlessRepackRefusal(
      'unsupported-footnotes',
      'footnote edits are not supported via legacy repack'
    );
  }
  if ((ctx.baseline.endnotes?.length ?? 0) !== (current.endnotes?.length ?? 0)) {
    return new HeadlessRepackRefusal(
      'unsupported-endnotes',
      'endnote edits are not supported via legacy repack'
    );
  }
  if (!packagesStructurallyEqual(ctx.baseline, current)) {
    return new HeadlessRepackRefusal(
      'unsupported-structural-change',
      'block or table structure changed — legacy repack refuses rather than drop content'
    );
  }

  const main = ctx.package.parts.get(ctx.package.mainDocumentPart);
  if (!main) return new HeadlessRepackRefusal('missing-part', 'main document part missing');
  const store = new TreePackageStore(ctx.package, main);

  const resolutions = pendingResolutions;
  const resolvedKeys = resolvedKeysFrom(resolutions);

  if (resolutions.length > 0) {
    const byScope = new Map<string, RecordedResolution[]>();
    for (const resolution of resolutions) {
      const scope = storyScopeFor(resolution.ref);
      const key = JSON.stringify(scope);
      const bucket = byScope.get(key) ?? [];
      bucket.push(resolution);
      byScope.set(key, bucket);
    }
    for (const [key, scopedResolutions] of byScope) {
      const scope = JSON.parse(key) as ReturnType<typeof storyScopeFor>;
      const err = applyStoryOps(store, scope, resolutionOps(scopedResolutions));
      if (err) return err;
    }
  }

  const baseParas = flattenParagraphs(ctx.baseline.document).filter(
    (block): block is Paragraph => block.type === 'paragraph'
  );
  const curParas = flattenParagraphs(current.document).filter(
    (block): block is Paragraph => block.type === 'paragraph'
  );

  const textOps = collectTextOps(ctx, ctx.baseline, current);
  if (textOps instanceof HeadlessRepackRefusal) return textOps;
  const textErr = applyOps(store, textOps);
  if (textErr) return textErr;

  const trackedOps = collectTrackedOps(
    main,
    baseParas,
    curParas,
    ctx.paragraphIds,
    resolvedKeys,
    'body'
  );
  if (trackedOps instanceof HeadlessRepackRefusal) return trackedOps;
  const trackedErr = applyOps(store, trackedOps);
  if (trackedErr) return trackedErr;

  const footnoteOps = collectNoteTrackedOps(
    ctx,
    ctx.baseline.footnotes,
    current.footnotes,
    'footnote',
    resolvedKeys
  );
  if (footnoteOps instanceof HeadlessRepackRefusal) return footnoteOps;
  const footnoteErr = applyStoryOps(
    store,
    { kind: 'notesPart', noteKind: 'footnote' },
    footnoteOps
  );
  if (footnoteErr) return footnoteErr;

  const endnoteOps = collectNoteTrackedOps(
    ctx,
    ctx.baseline.endnotes,
    current.endnotes,
    'endnote',
    resolvedKeys
  );
  if (endnoteOps instanceof HeadlessRepackRefusal) return endnoteOps;
  const endnoteErr = applyStoryOps(store, { kind: 'notesPart', noteKind: 'endnote' }, endnoteOps);
  if (endnoteErr) return endnoteErr;

  const commentErr = applyCommentAdds(store, ctx, ctx.baseline, current);
  if (commentErr) return commentErr;

  if (doc && resolutions.length > 0) acknowledgeResolutions(doc, resolutions);

  const out = writeOoxmlPackage(store.currentPackage());
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
