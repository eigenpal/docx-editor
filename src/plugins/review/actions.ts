import type {
  BlockSdt,
  Deletion,
  Document,
  HeaderFooter,
  Insertion,
  MoveFrom,
  MoveTo,
  Paragraph,
  ParagraphContent,
  Table,
} from '../../types/document';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ReviewDecision, ReviewRevisionItem, ReviewRevisionType } from './types';

interface RevisionOperation {
  type: 'delete' | 'removeMark';
  from: number;
  to: number;
  markType?: ReviewRevisionType;
}

interface PlannedOperations {
  operations: RevisionOperation[];
  consumedRevisionIds: string[];
}

type HeaderFooterLocation = 'header' | 'footer';
type HeaderFooterTrackedChange = Insertion | Deletion | MoveFrom | MoveTo;
type BodyBlock = Paragraph | Table | BlockSdt;

interface HeaderFooterPartTarget {
  location: HeaderFooterLocation;
  relationshipId: string;
  targets: Map<number, ReviewRevisionType>;
}

interface HeaderFooterTransformContext {
  targets: Map<number, ReviewRevisionType>;
  decision: ReviewDecision;
  cursor: number;
  consumed: Set<number>;
  changed: boolean;
}

function findRevisionById(
  revisions: readonly ReviewRevisionItem[],
  revisionId: string
): ReviewRevisionItem | null {
  return revisions.find((revision) => revision.id === revisionId) ?? null;
}

function findMovePair(
  revision: ReviewRevisionItem,
  revisions: readonly ReviewRevisionItem[]
): ReviewRevisionItem | null {
  if (!revision.pairId) return null;
  return findRevisionById(revisions, revision.pairId);
}

function normalizeMovePair(
  revision: ReviewRevisionItem,
  pair: ReviewRevisionItem | null
): { source: ReviewRevisionItem; destination: ReviewRevisionItem } | null {
  if (!pair) return null;

  const source = revision.type === 'moveFrom' ? revision : pair;
  const destination = revision.type === 'moveTo' ? revision : pair;
  if (source.type !== 'moveFrom' || destination.type !== 'moveTo') return null;
  return { source, destination };
}

function isHeaderFooterRevision(revision: ReviewRevisionItem): boolean {
  return revision.location === 'header' || revision.location === 'footer';
}

function isTargetableBodyModelRevision(revision: ReviewRevisionItem): boolean {
  if (revision.location !== 'body') return false;
  if (revision.applyTarget !== 'documentModel') return false;
  if (revision.status !== 'supported') return false;
  if (!revision.sourceParagraphId) return false;
  return revision.sourceParagraphChangeKind === 'paragraphProperties';
}

function isTargetableHeaderFooterRevision(revision: ReviewRevisionItem): boolean {
  if (!isHeaderFooterRevision(revision)) return false;
  if (revision.status !== 'supported') return false;
  if (!revision.sourceRelationshipId) return false;
  return revision.sourceChangeIndex !== null;
}

function revisionDeleteOperation(revision: ReviewRevisionItem): RevisionOperation {
  return {
    type: 'delete',
    from: revision.from,
    to: revision.to,
  };
}

function revisionRemoveMarkOperation(
  revision: ReviewRevisionItem,
  markType: ReviewRevisionType = revision.type
): RevisionOperation {
  return {
    type: 'removeMark',
    from: revision.from,
    to: revision.to,
    markType,
  };
}

function buildOperationsForRevision(
  revision: ReviewRevisionItem,
  revisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): PlannedOperations | null {
  if (revision.location !== 'body') return null;
  if (revision.applyTarget !== 'pm') return null;
  if (revision.status !== 'supported') return null;

  switch (revision.type) {
    case 'insertion':
      return decision === 'accept'
        ? {
            operations: [revisionRemoveMarkOperation(revision, 'insertion')],
            consumedRevisionIds: [revision.id],
          }
        : {
            operations: [revisionDeleteOperation(revision)],
            consumedRevisionIds: [revision.id],
          };

    case 'deletion':
      return decision === 'accept'
        ? {
            operations: [revisionDeleteOperation(revision)],
            consumedRevisionIds: [revision.id],
          }
        : {
            operations: [revisionRemoveMarkOperation(revision, 'deletion')],
            consumedRevisionIds: [revision.id],
          };

    case 'moveFrom':
    case 'moveTo': {
      const pair = findMovePair(revision, revisions);
      const normalized = normalizeMovePair(revision, pair);
      if (!normalized) return null;
      if (
        normalized.source.status !== 'supported' ||
        normalized.destination.status !== 'supported'
      ) {
        return null;
      }

      const operations =
        decision === 'accept'
          ? [
              revisionDeleteOperation(normalized.source),
              revisionRemoveMarkOperation(normalized.destination, 'moveTo'),
            ]
          : [
              revisionRemoveMarkOperation(normalized.source, 'moveFrom'),
              revisionDeleteOperation(normalized.destination),
            ];

      return {
        operations,
        consumedRevisionIds: [normalized.source.id, normalized.destination.id],
      };
    }

    case 'formatChange':
      return null;
  }
}

function dedupeOperations(operations: readonly RevisionOperation[]): RevisionOperation[] {
  const unique = new Map<string, RevisionOperation>();
  for (const operation of operations) {
    const key =
      operation.type === 'delete'
        ? `delete:${operation.from}:${operation.to}`
        : `remove:${operation.markType}:${operation.from}:${operation.to}`;
    if (!unique.has(key)) {
      unique.set(key, operation);
    }
  }
  return [...unique.values()];
}

function createTransactionFromOperations(
  state: EditorState,
  rawOperations: readonly RevisionOperation[]
): Transaction | null {
  const operations = dedupeOperations(rawOperations).sort((a, b) => {
    if (a.from !== b.from) return b.from - a.from;
    if (a.to !== b.to) return b.to - a.to;
    if (a.type === b.type) return 0;
    return a.type === 'delete' ? -1 : 1;
  });

  if (operations.length === 0) return null;

  const tr = state.tr;

  for (const operation of operations) {
    const mappedFrom = tr.mapping.map(operation.from, 1);
    const mappedTo = tr.mapping.map(operation.to, -1);
    if (mappedFrom >= mappedTo) continue;

    if (operation.type === 'delete') {
      tr.delete(mappedFrom, mappedTo);
      continue;
    }

    if (!operation.markType) continue;
    const markType = state.schema.marks[operation.markType];
    if (!markType) continue;
    tr.removeMark(mappedFrom, mappedTo, markType);
  }

  if (tr.steps.length === 0) return null;
  return tr.scrollIntoView();
}

function trackedChangeDecisionContent(
  change: HeaderFooterTrackedChange,
  decision: ReviewDecision
): ParagraphContent[] {
  if (change.type === 'insertion') {
    return decision === 'accept' ? [...change.content] : [];
  }
  if (change.type === 'deletion') {
    return decision === 'accept' ? [] : [...change.content];
  }
  if (change.type === 'moveFrom') {
    return decision === 'accept' ? [] : [...change.content];
  }
  return decision === 'accept' ? [...change.content] : [];
}

function isTrackedParagraphContent(
  content: ParagraphContent
): content is HeaderFooterTrackedChange {
  return (
    content.type === 'insertion' ||
    content.type === 'deletion' ||
    content.type === 'moveFrom' ||
    content.type === 'moveTo'
  );
}

function transformParagraphContent(
  content: ParagraphContent[],
  context: HeaderFooterTransformContext
): ParagraphContent[] {
  const next: ParagraphContent[] = [];

  for (const item of content) {
    if (!isTrackedParagraphContent(item)) {
      next.push(item);
      continue;
    }

    const index = context.cursor;
    context.cursor += 1;
    const expectedType = context.targets.get(index);
    if (expectedType === undefined || expectedType !== item.type) {
      next.push(item);
      continue;
    }

    context.changed = true;
    context.consumed.add(index);
    next.push(...trackedChangeDecisionContent(item, context.decision));
  }

  return next;
}

function transformBlocks(
  blocks: Array<Paragraph | Table>,
  context: HeaderFooterTransformContext
): Array<Paragraph | Table> {
  return blocks.map((block) => {
    if (block.type === 'paragraph') {
      return {
        ...block,
        content: transformParagraphContent(block.content, context),
      };
    }

    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          content: transformBlocks(cell.content, context),
        })),
      })),
    };
  });
}

function clonePartMapIfNeeded(
  map: Map<string, HeaderFooter> | undefined
): Map<string, HeaderFooter> | undefined {
  if (!map) return undefined;
  return new Map(map);
}

function collectHeaderFooterRevisionsForSingleDecision(
  revisions: readonly ReviewRevisionItem[],
  revisionId: string
): ReviewRevisionItem[] | null {
  const revision = findRevisionById(revisions, revisionId);
  if (!revision || !isTargetableHeaderFooterRevision(revision)) {
    return null;
  }

  if (revision.type === 'moveFrom' || revision.type === 'moveTo') {
    const pair = findMovePair(revision, revisions);
    const normalized = normalizeMovePair(revision, pair);
    if (!normalized) return null;
    if (
      !isTargetableHeaderFooterRevision(normalized.source) ||
      !isTargetableHeaderFooterRevision(normalized.destination)
    ) {
      return null;
    }
    return [normalized.source, normalized.destination];
  }

  return [revision];
}

function collectHeaderFooterRevisionsForBulkDecision(
  revisions: readonly ReviewRevisionItem[]
): ReviewRevisionItem[] {
  const collected: ReviewRevisionItem[] = [];
  const consumed = new Set<string>();

  for (const revision of revisions) {
    if (consumed.has(revision.id)) continue;
    if (!isTargetableHeaderFooterRevision(revision)) continue;

    if (revision.type === 'moveFrom' || revision.type === 'moveTo') {
      const pair = findMovePair(revision, revisions);
      const normalized = normalizeMovePair(revision, pair);
      if (!normalized) continue;
      if (
        !isTargetableHeaderFooterRevision(normalized.source) ||
        !isTargetableHeaderFooterRevision(normalized.destination)
      ) {
        continue;
      }

      collected.push(normalized.source, normalized.destination);
      consumed.add(normalized.source.id);
      consumed.add(normalized.destination.id);
      continue;
    }

    collected.push(revision);
    consumed.add(revision.id);
  }

  return collected;
}

function buildHeaderFooterPartTargets(
  revisions: readonly ReviewRevisionItem[]
): HeaderFooterPartTarget[] | null {
  const grouped = new Map<string, HeaderFooterPartTarget>();

  for (const revision of revisions) {
    if (!isTargetableHeaderFooterRevision(revision)) {
      return null;
    }

    const relationshipId = revision.sourceRelationshipId!;
    const sourceChangeIndex = revision.sourceChangeIndex!;
    const location = revision.location as HeaderFooterLocation;
    const key = `${location}:${relationshipId}`;
    const group = grouped.get(key) ?? {
      location,
      relationshipId,
      targets: new Map<number, ReviewRevisionType>(),
    };
    const existingType = group.targets.get(sourceChangeIndex);
    if (existingType && existingType !== revision.type) {
      return null;
    }
    group.targets.set(sourceChangeIndex, revision.type);
    grouped.set(key, group);
  }

  return [...grouped.values()];
}

function applyHeaderFooterPartDecision(
  part: HeaderFooter,
  targets: Map<number, ReviewRevisionType>,
  decision: ReviewDecision
): HeaderFooter | null {
  const context: HeaderFooterTransformContext = {
    targets,
    decision,
    cursor: 0,
    consumed: new Set<number>(),
    changed: false,
  };
  const transformedContent = transformBlocks(part.content, context);
  if (!context.changed) return null;
  if (context.consumed.size !== targets.size) {
    return null;
  }
  return {
    ...part,
    content: transformedContent,
  };
}

function applyHeaderFooterDecisionToDocument(
  document: Document,
  targetRevisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): Document | null {
  const partTargets = buildHeaderFooterPartTargets(targetRevisions);
  if (!partTargets || partTargets.length === 0) {
    return null;
  }

  let nextHeaders = document.package.headers;
  let nextFooters = document.package.footers;
  let changed = false;

  for (const partTarget of partTargets) {
    const sourceMap =
      partTarget.location === 'header' ? document.package.headers : document.package.footers;
    const sourcePart = sourceMap?.get(partTarget.relationshipId);
    if (!sourceMap || !sourcePart) {
      return null;
    }

    const updatedPart = applyHeaderFooterPartDecision(sourcePart, partTarget.targets, decision);
    if (!updatedPart) {
      return null;
    }

    if (partTarget.location === 'header') {
      nextHeaders =
        nextHeaders === document.package.headers ? clonePartMapIfNeeded(nextHeaders) : nextHeaders;
      nextHeaders?.set(partTarget.relationshipId, updatedPart);
    } else {
      nextFooters =
        nextFooters === document.package.footers ? clonePartMapIfNeeded(nextFooters) : nextFooters;
      nextFooters?.set(partTarget.relationshipId, updatedPart);
    }
    changed = true;
  }

  if (!changed) return null;

  return {
    ...document,
    package: {
      ...document.package,
      headers: nextHeaders,
      footers: nextFooters,
    },
  };
}

function collectBodyModelRevisionsForSingleDecision(
  revisions: readonly ReviewRevisionItem[],
  revisionId: string
): ReviewRevisionItem[] | null {
  const revision = findRevisionById(revisions, revisionId);
  if (!revision || !isTargetableBodyModelRevision(revision)) {
    return null;
  }
  return [revision];
}

function collectBodyModelRevisionsForBulkDecision(
  revisions: readonly ReviewRevisionItem[]
): ReviewRevisionItem[] {
  return revisions.filter((revision) => isTargetableBodyModelRevision(revision));
}

interface BodyModelTransformState {
  changed: boolean;
  failed: boolean;
  appliedParagraphIds: Set<string>;
}

function transformBodyBlocksForDecision(
  blocks: BodyBlock[],
  targetByParagraphId: Map<string, ReviewRevisionItem>,
  decision: ReviewDecision,
  state: BodyModelTransformState
): BodyBlock[] {
  return blocks.map((block) => {
    if (block.type === 'paragraph') {
      const paragraphId = block.paraId;
      if (!paragraphId) return block;

      const target = targetByParagraphId.get(paragraphId);
      if (!target) return block;
      if (target.sourceParagraphChangeKind !== 'paragraphProperties') {
        state.failed = true;
        return block;
      }

      const propertiesChange = block.paragraphPropertiesChange;
      if (!propertiesChange) {
        state.failed = true;
        return block;
      }
      if (propertiesChange.info.id !== target.revisionId) {
        state.failed = true;
        return block;
      }

      state.changed = true;
      state.appliedParagraphIds.add(paragraphId);

      if (decision === 'accept') {
        return {
          ...block,
          paragraphPropertiesChange: undefined,
        };
      }

      return {
        ...block,
        formatting: propertiesChange.previousFormatting,
        paragraphPropertiesChange: undefined,
        listRendering: undefined,
      };
    }

    if (block.type === 'table') {
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: transformBodyBlocksForDecision(
              cell.content as BodyBlock[],
              targetByParagraphId,
              decision,
              state
            ) as Array<Paragraph | Table>,
          })),
        })),
      };
    }

    return {
      ...block,
      content: transformBodyBlocksForDecision(
        block.content as BodyBlock[],
        targetByParagraphId,
        decision,
        state
      ) as Array<Paragraph | Table>,
    };
  });
}

function applyBodyModelDecisionToDocument(
  document: Document,
  targetRevisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): Document | null {
  if (!document.package.document) return null;
  if (targetRevisions.length === 0) return null;

  const targetByParagraphId = new Map<string, ReviewRevisionItem>();
  for (const revision of targetRevisions) {
    if (!isTargetableBodyModelRevision(revision) || !revision.sourceParagraphId) {
      return null;
    }
    const existing = targetByParagraphId.get(revision.sourceParagraphId);
    if (existing && existing.id !== revision.id) {
      return null;
    }
    targetByParagraphId.set(revision.sourceParagraphId, revision);
  }

  const state: BodyModelTransformState = {
    changed: false,
    failed: false,
    appliedParagraphIds: new Set<string>(),
  };
  const nextContent = transformBodyBlocksForDecision(
    document.package.document.content as BodyBlock[],
    targetByParagraphId,
    decision,
    state
  ) as Array<Paragraph | Table>;

  if (state.failed) return null;
  if (!state.changed) return null;
  if (state.appliedParagraphIds.size !== targetByParagraphId.size) return null;

  return {
    ...document,
    package: {
      ...document.package,
      document: {
        ...document.package.document,
        content: nextContent,
      },
    },
  };
}

export function canApplyHeaderFooterRevisionDecision(
  revisions: readonly ReviewRevisionItem[],
  revisionId: string
): boolean {
  return collectHeaderFooterRevisionsForSingleDecision(revisions, revisionId) !== null;
}

export function canApplyBodyModelRevisionDecision(
  revisions: readonly ReviewRevisionItem[],
  revisionId: string
): boolean {
  return collectBodyModelRevisionsForSingleDecision(revisions, revisionId) !== null;
}

export function canApplyBulkHeaderFooterRevisionDecision(
  revisions: readonly ReviewRevisionItem[]
): boolean {
  return collectHeaderFooterRevisionsForBulkDecision(revisions).length > 0;
}

export function canApplyBulkBodyModelRevisionDecision(
  revisions: readonly ReviewRevisionItem[]
): boolean {
  return collectBodyModelRevisionsForBulkDecision(revisions).length > 0;
}

export function applyHeaderFooterRevisionDecisionToDocument(
  document: Document,
  revisions: readonly ReviewRevisionItem[],
  revisionId: string,
  decision: ReviewDecision
): Document | null {
  const targetRevisions = collectHeaderFooterRevisionsForSingleDecision(revisions, revisionId);
  if (!targetRevisions) return null;
  return applyHeaderFooterDecisionToDocument(document, targetRevisions, decision);
}

export function applyBodyModelRevisionDecisionToDocument(
  document: Document,
  revisions: readonly ReviewRevisionItem[],
  revisionId: string,
  decision: ReviewDecision
): Document | null {
  const targetRevisions = collectBodyModelRevisionsForSingleDecision(revisions, revisionId);
  if (!targetRevisions) return null;
  return applyBodyModelDecisionToDocument(document, targetRevisions, decision);
}

export function applyBulkHeaderFooterRevisionDecisionToDocument(
  document: Document,
  revisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): Document | null {
  const targetRevisions = collectHeaderFooterRevisionsForBulkDecision(revisions);
  if (targetRevisions.length === 0) return null;
  return applyHeaderFooterDecisionToDocument(document, targetRevisions, decision);
}

export function applyBulkBodyModelRevisionDecisionToDocument(
  document: Document,
  revisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): Document | null {
  const targetRevisions = collectBodyModelRevisionsForBulkDecision(revisions);
  if (targetRevisions.length === 0) return null;
  return applyBodyModelDecisionToDocument(document, targetRevisions, decision);
}

export function createRevisionDecisionTransaction(
  state: EditorState,
  revisions: readonly ReviewRevisionItem[],
  revisionId: string,
  decision: ReviewDecision
): Transaction | null {
  const revision = findRevisionById(revisions, revisionId);
  if (!revision) return null;

  const planned = buildOperationsForRevision(revision, revisions, decision);
  if (!planned) return null;

  return createTransactionFromOperations(state, planned.operations);
}

export function createBulkRevisionDecisionTransaction(
  state: EditorState,
  revisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): Transaction | null {
  const consumed = new Set<string>();
  const operations: RevisionOperation[] = [];

  for (const revision of revisions) {
    if (consumed.has(revision.id)) continue;
    if (revision.status !== 'supported') continue;

    const planned = buildOperationsForRevision(revision, revisions, decision);
    if (!planned) continue;

    operations.push(...planned.operations);
    for (const revisionId of planned.consumedRevisionIds) {
      consumed.add(revisionId);
    }
  }

  return createTransactionFromOperations(state, operations);
}

export function applyRevisionDecision(
  view: EditorView,
  revisions: readonly ReviewRevisionItem[],
  revisionId: string,
  decision: ReviewDecision
): boolean {
  const tr = createRevisionDecisionTransaction(view.state, revisions, revisionId, decision);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

export function applyBulkRevisionDecision(
  view: EditorView,
  revisions: readonly ReviewRevisionItem[],
  decision: ReviewDecision
): boolean {
  const tr = createBulkRevisionDecisionTransaction(view.state, revisions, decision);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}
