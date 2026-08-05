import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type {
  RevisionAddress,
  RevisionAttributionInput,
  TreeDocOp,
} from '../store/store/tree-op-types.ts';
import { getHyperlinkText, getRunText } from './helpers.ts';
import { isTrackedChangeItem, trackedChangeText, type TrackedChangeItem } from './legacy-model.ts';
import { legacyOffsetToTreeOffset } from './legacy-offsets.ts';
import { legacyParagraphPlainText } from './legacy-text.ts';
import type { Paragraph, ParagraphContent, TrackedChangeInfo } from './types.ts';
import { HeadlessRepackRefusal } from './headless-errors.ts';

function revisionAttribution(info: TrackedChangeInfo): RevisionAttributionInput {
  return { author: info.author, ...(info.date === undefined ? {} : { date: info.date }) };
}

function revisionAddress(info: TrackedChangeInfo): RevisionAddress {
  return {
    id: String(info.id),
    author: info.author,
    ...(info.date === undefined ? {} : { date: info.date }),
  };
}

function revisionLocalName(type: TrackedChangeItem['type']): string {
  switch (type) {
    case 'insertion':
      return 'ins';
    case 'deletion':
      return 'del';
    case 'moveFrom':
      return 'moveFrom';
    case 'moveTo':
      return 'moveTo';
  }
}

function trackedById(para: Paragraph): Map<string, TrackedChangeItem> {
  const map = new Map<string, TrackedChangeItem>();
  for (const item of para.content) {
    if (isTrackedChangeItem(item)) {
      map.set(`${item.type}:${item.info.id}`, item);
    }
  }
  return map;
}

function trackedItemKey(item: TrackedChangeItem): string {
  return `${item.type}:${item.info.id}`;
}

function trackedSignature(item: TrackedChangeItem): string {
  return `${item.type}:${item.info.id}:${item.info.author}:${item.info.date ?? ''}:${trackedChangeText(item.content)}`;
}

interface TrackedPlan {
  deletions: Array<{
    start: number;
    end: number;
    revision: RevisionAttributionInput;
  }>;
  insertions: Array<{
    offset: number;
    text: string;
    revision: RevisionAttributionInput;
  }>;
  resolutions: Array<{
    op: 'acceptRevision' | 'rejectRevision';
    revision: RevisionAddress;
    localName: string;
  }>;
}

function findBaselineOffset(baseText: string, needle: string, from: number): number | null {
  const index = baseText.indexOf(needle, from);
  return index >= 0 ? index : null;
}

function planTrackedParagraphEdits(
  basePara: Paragraph,
  curPara: Paragraph,
  resolvedKeys?: ReadonlySet<string>,
  storyKeyPrefix = 'body'
): TrackedPlan | HeadlessRepackRefusal {
  const baseById = trackedById(basePara);
  const curById = trackedById(curPara);
  const baseText = legacyParagraphPlainText(basePara);

  for (const [key, item] of curById) {
    const existing = baseById.get(key);
    if (existing && trackedSignature(existing) !== trackedSignature(item)) {
      return new HeadlessRepackRefusal(
        'modified-existing-tracked-change',
        `revision ${item.info.id} was altered — refusing ambiguous tracked edit`
      );
    }
  }

  const deletions: TrackedPlan['deletions'] = [];
  const insertions: TrackedPlan['insertions'] = [];
  const resolutions: TrackedPlan['resolutions'] = [];

  for (const [trackedKey, baseItem] of baseById) {
    if (curById.has(trackedKey)) continue;
    if (baseItem.type === 'moveFrom' || baseItem.type === 'moveTo') {
      continue;
    }
    const resolvedKey = `${storyKeyPrefix}:${revisionLocalName(baseItem.type)}:${baseItem.info.id}:${baseItem.info.author}:${baseItem.info.date ?? ''}`;
    if (resolvedKeys?.has(resolvedKey)) continue;
    const mode = inferRemovedRevisionMode(baseItem, basePara, curPara);
    if (!mode) {
      return new HeadlessRepackRefusal(
        'ambiguous-tracked-resolution',
        `cannot infer accept/reject for removed revision ${baseItem.info.id}`
      );
    }
    resolutions.push({
      op: mode,
      revision: revisionAddress(baseItem.info),
      localName: revisionLocalName(baseItem.type),
    });
  }

  let searchFrom = 0;
  for (const item of curPara.content) {
    if (!isTrackedChangeItem(item)) continue;
    if (baseById.has(trackedItemKey(item))) continue;
    if (item.type === 'moveFrom' || item.type === 'moveTo') {
      return new HeadlessRepackRefusal(
        'unsupported-tracked-change',
        'move revisions are not supported via legacy repack'
      );
    }
    const revision = revisionAttribution(item.info);
    const text = trackedChangeText(item.content);
    if (item.type === 'deletion') {
      if (text.length === 0) {
        return new HeadlessRepackRefusal('unsupported-tracked-change', 'empty tracked deletion');
      }
      const start = findBaselineOffset(baseText, text, searchFrom);
      if (start === null) {
        return new HeadlessRepackRefusal(
          'unsupported-tracked-change',
          `tracked deletion text does not match baseline at offset ${searchFrom}`
        );
      }
      deletions.push({ start, end: start + text.length, revision });
      searchFrom = start + text.length;
      continue;
    }
    if (item.type === 'insertion') {
      const offset = deletions.at(-1)?.start ?? searchFrom;
      if (text.length > 0) {
        insertions.push({ offset, text, revision });
      }
      continue;
    }
  }

  return { deletions, insertions, resolutions };
}

function inferRemovedRevisionMode(
  baseItem: TrackedChangeItem,
  basePara: Paragraph,
  curPara: Paragraph
): 'acceptRevision' | 'rejectRevision' | null {
  const baseText = legacyParagraphPlainText(basePara);
  const curText = legacyParagraphPlainText(curPara);
  const itemText = trackedChangeText(baseItem.content);
  if (baseItem.type === 'insertion') {
    if (curText.includes(itemText) && !baseText.includes(itemText)) return 'acceptRevision';
    if (!curText.includes(itemText)) return 'rejectRevision';
    return curText === baseText.replace(itemText, '') ? 'rejectRevision' : 'acceptRevision';
  }
  if (baseItem.type === 'deletion') {
    if (!curText.includes(itemText) && baseText.includes(itemText)) return 'acceptRevision';
    if (curText.includes(itemText) && !baseByIdHasDeletion(curPara, baseItem.info.id)) {
      return 'rejectRevision';
    }
    return curText.includes(itemText) ? 'rejectRevision' : 'acceptRevision';
  }
  return null;
}

function baseByIdHasDeletion(para: Paragraph, id: number): boolean {
  return para.content.some(
    (item) => isTrackedChangeItem(item) && item.type === 'deletion' && item.info.id === id
  );
}

function plansToOps(
  part: OoxmlPart,
  paragraphId: string,
  plan: TrackedPlan
): TreeDocOp[] | HeadlessRepackRefusal {
  const ops: TreeDocOp[] = [];
  const orderedDeletions = [...plan.deletions].sort((a, b) => b.start - a.start);
  for (const deletion of orderedDeletions) {
    try {
      const start = legacyOffsetToTreeOffset(part, paragraphId, deletion.start);
      const end = legacyOffsetToTreeOffset(part, paragraphId, deletion.end);
      if (end > start) {
        ops.push({ op: 'deleteText', paragraphId, start, end, revision: deletion.revision });
      }
    } catch (error) {
      if (error instanceof HeadlessRepackRefusal) return error;
      throw error;
    }
  }
  const orderedInsertions = [...plan.insertions].sort((a, b) => b.offset - a.offset);
  for (const insertion of orderedInsertions) {
    try {
      const offset = legacyOffsetToTreeOffset(part, paragraphId, insertion.offset);
      if (insertion.text.length > 0) {
        ops.push({
          op: 'insertText',
          paragraphId,
          offset,
          text: insertion.text,
          revision: insertion.revision,
        });
      }
    } catch (error) {
      if (error instanceof HeadlessRepackRefusal) return error;
      throw error;
    }
  }
  for (const resolution of plan.resolutions) {
    ops.push({ op: resolution.op, revision: resolution.revision });
  }
  return ops;
}

export function collectTrackedOps(
  part: OoxmlPart,
  baseParas: readonly Paragraph[],
  curParas: readonly Paragraph[],
  paragraphIds: readonly string[],
  resolvedKeys?: ReadonlySet<string>,
  storyKeyPrefix = 'body'
): TreeDocOp[] | HeadlessRepackRefusal {
  const ops: TreeDocOp[] = [];
  for (let index = 0; index < baseParas.length; index += 1) {
    const basePara = baseParas[index]!;
    const curPara = curParas[index]!;
    const paragraphId = paragraphIds[index];
    if (!paragraphId) {
      return new HeadlessRepackRefusal('missing-anchor', `no tree anchor for paragraph ${index}`);
    }
    const plan = planTrackedParagraphEdits(basePara, curPara, resolvedKeys, storyKeyPrefix);
    if (plan instanceof HeadlessRepackRefusal) return plan;
    if (
      plan.deletions.length === 0 &&
      plan.insertions.length === 0 &&
      plan.resolutions.length === 0
    ) {
      continue;
    }
    const paragraphOps = plansToOps(part, paragraphId, plan);
    if (paragraphOps instanceof HeadlessRepackRefusal) return paragraphOps;
    ops.push(...paragraphOps);
  }
  return ops;
}

export function hasTrackedChangeDelta(basePara: Paragraph, curPara: Paragraph): boolean {
  if (trackedById(basePara).size !== trackedById(curPara).size) return true;
  for (const [key, item] of trackedById(curPara)) {
    const baseItem = trackedById(basePara).get(key);
    if (!baseItem || trackedSignature(baseItem) !== trackedSignature(item)) return true;
  }
  return false;
}

export function legacyComparableText(para: Paragraph, newTrackedIds: ReadonlySet<number>): string {
  const parts: string[] = [];
  for (const item of para.content) {
    if (item.type === 'run') parts.push(getRunText(item));
    else if (item.type === 'hyperlink') parts.push(getHyperlinkText(item));
    else if (isTrackedChangeItem(item)) {
      if (newTrackedIds.has(item.info.id) && item.type === 'insertion') continue;
      parts.push(trackedChangeText(item.content));
    }
  }
  return parts.join('');
}

export function newTrackedIds(basePara: Paragraph, curPara: Paragraph): Set<number> {
  const baseById = trackedById(basePara);
  const ids = new Set<number>();
  for (const [key, item] of trackedById(curPara)) {
    if (!baseById.has(key)) ids.add(item.info.id);
  }
  return ids;
}

export function resolutionLocalName(
  type: TrackedChangeItem['type'] | ParagraphContent['type']
): string | null {
  if (type === 'insertion') return 'ins';
  if (type === 'deletion') return 'del';
  if (type === 'moveFrom') return 'moveFrom';
  if (type === 'moveTo') return 'moveTo';
  return null;
}

export { revisionLocalName, revisionAddress };
