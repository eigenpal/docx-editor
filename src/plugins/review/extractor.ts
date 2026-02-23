import type { Node as PMNode, Mark } from 'prosemirror-model';
import type {
  BlockSdt,
  Document,
  HeaderReference,
  FooterReference,
  Hyperlink,
  Paragraph,
  ParagraphContent,
  Run,
  RunContent,
  Table,
  TrackedChangeInfo,
  MoveRangeInfo,
} from '../../types/document';
import type {
  ReviewHeaderFooterReferenceType,
  ReviewPluginState,
  ReviewRevisionItem,
  ReviewRevisionType,
} from './types';

const TRACKED_MARK_TYPES: readonly ReviewRevisionType[] = [
  'insertion',
  'deletion',
  'moveFrom',
  'moveTo',
];

const PREVIEW_MAX_LENGTH = 160;
const HEADER_FOOTER_MISSING_MOVE_RANGE_REASON = 'Move revision is missing rangeId.';
const PARAGRAPH_MARK_MOVE_READONLY_REASON =
  'Paragraph-mark move revisions are currently read-only in the editor.';
interface RevisionSegment {
  type: ReviewRevisionType;
  from: number;
  to: number;
  rawText: string;
  revisionId: number;
  author: string;
  date: string | null;
  rangeId: number | null;
  rangeName: string | null;
  rangeAuthor: string | null;
  rangeDate: string | null;
  status: 'supported' | 'unsupported';
  reason: string | null;
}

function isTrackedMarkType(name: string): name is ReviewRevisionType {
  return TRACKED_MARK_TYPES.includes(name as ReviewRevisionType);
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeRevisionId(value: unknown): number {
  const normalized = normalizeNumber(value);
  return normalized ?? 0;
}

function markToSegment(
  mark: Mark,
  from: number,
  to: number,
  rawText: string,
  hasOverlappingTrackedMarks: boolean
): RevisionSegment {
  const type = mark.type.name as ReviewRevisionType;
  const rangeId = normalizeNumber(mark.attrs.rangeId);
  const rangeName = normalizeString(mark.attrs.rangeName);

  let status: RevisionSegment['status'] = 'supported';
  let reason: string | null = null;

  if (hasOverlappingTrackedMarks) {
    status = 'unsupported';
    reason = 'Overlapping tracked-change marks on the same content.';
  } else if ((type === 'moveFrom' || type === 'moveTo') && rangeId === null && rangeName === null) {
    status = 'unsupported';
    reason = 'Move revision is missing rangeId.';
  }

  return {
    type,
    from,
    to,
    rawText,
    revisionId: normalizeRevisionId(mark.attrs.revisionId),
    author: normalizeString(mark.attrs.author) ?? 'Unknown',
    date: normalizeString(mark.attrs.date),
    rangeId,
    rangeName,
    rangeAuthor: normalizeString(mark.attrs.rangeAuthor),
    rangeDate: normalizeString(mark.attrs.rangeDate),
    status,
    reason,
  };
}

function canMerge(a: RevisionSegment, b: RevisionSegment): boolean {
  return (
    a.type === b.type &&
    a.revisionId === b.revisionId &&
    a.author === b.author &&
    a.date === b.date &&
    a.rangeId === b.rangeId &&
    a.rangeName === b.rangeName &&
    a.rangeAuthor === b.rangeAuthor &&
    a.rangeDate === b.rangeDate &&
    a.status === b.status &&
    a.reason === b.reason &&
    a.to === b.from
  );
}

function sanitizePreview(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return '[non-text]';
  if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

function rawTextForInlineNode(node: PMNode): string {
  if (node.isText) return node.text ?? '';
  if (node.type.name === 'hardBreak') return '\n';
  return `<${node.type.name}>`;
}

function buildRevisionId(segment: RevisionSegment, index: number): string {
  const rangeKey = segment.rangeId === null ? 'na' : String(segment.rangeId);
  const rangeNameKey = segment.rangeName === null ? 'na' : encodeURIComponent(segment.rangeName);
  return `${segment.type}:${segment.revisionId}:${rangeKey}:${rangeNameKey}:${segment.from}:${segment.to}:${index}`;
}

function moveScopeKey(revision: ReviewRevisionItem): string {
  return [
    revision.location,
    revision.sourceRelationshipId ?? 'body',
    revision.headerFooterRefType ?? 'na',
  ].join(':');
}

function pairMovesByKey(
  fromPool: Set<ReviewRevisionItem>,
  toPool: Set<ReviewRevisionItem>,
  keyBuilder: (revision: ReviewRevisionItem) => string | null
): void {
  const buckets = new Map<string, { from: ReviewRevisionItem[]; to: ReviewRevisionItem[] }>();

  for (const revision of fromPool) {
    const key = keyBuilder(revision);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { from: [], to: [] };
    bucket.from.push(revision);
    buckets.set(key, bucket);
  }

  for (const revision of toPool) {
    const key = keyBuilder(revision);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { from: [], to: [] };
    bucket.to.push(revision);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    if (bucket.from.length !== 1 || bucket.to.length !== 1) continue;
    const source = bucket.from[0];
    const destination = bucket.to[0];
    source.pairId = destination.id;
    destination.pairId = source.id;
    fromPool.delete(source);
    toPool.delete(destination);
  }
}

function markMovePairing(revisions: ReviewRevisionItem[]): void {
  const moveScopes = new Map<
    string,
    { from: Set<ReviewRevisionItem>; to: Set<ReviewRevisionItem> }
  >();

  for (const revision of revisions) {
    if (revision.type !== 'moveFrom' && revision.type !== 'moveTo') continue;
    if (revision.status !== 'supported') continue;

    const groupKey = moveScopeKey(revision);
    const group = moveScopes.get(groupKey) ?? { from: new Set(), to: new Set() };
    if (revision.type === 'moveFrom') {
      group.from.add(revision);
    } else {
      group.to.add(revision);
    }
    moveScopes.set(groupKey, group);
  }

  for (const group of moveScopes.values()) {
    // Word often links move pairs by range name while using distinct range IDs.
    pairMovesByKey(group.from, group.to, (revision) =>
      revision.rangeName === null ? null : `name:${revision.rangeName}`
    );
    pairMovesByKey(group.from, group.to, (revision) =>
      revision.rangeId === null ? null : `id:${revision.rangeId}`
    );

    for (const item of [...group.from, ...group.to]) {
      item.status = 'unsupported';
      item.reason = 'Move revision pair is ambiguous or incomplete.';
    }
  }
}

export function extractRevisionsFromDoc(doc: PMNode): ReviewRevisionItem[] {
  const segments: RevisionSegment[] = [];

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isInline) return true;

    const trackedMarks = node.marks.filter((mark) => isTrackedMarkType(mark.type.name));
    if (trackedMarks.length === 0) return true;

    const from = pos;
    const to = pos + node.nodeSize;
    const rawText = rawTextForInlineNode(node);
    const hasOverlap = trackedMarks.length > 1;

    for (const mark of trackedMarks) {
      segments.push(markToSegment(mark, from, to, rawText, hasOverlap));
    }

    return true;
  });

  segments.sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: RevisionSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && canMerge(previous, segment)) {
      previous.to = segment.to;
      previous.rawText += segment.rawText;
    } else {
      merged.push({ ...segment });
    }
  }

  const revisions = merged.map<ReviewRevisionItem>((segment, index) => ({
    id: buildRevisionId(segment, index),
    type: segment.type,
    from: segment.from,
    to: segment.to,
    textPreview: sanitizePreview(segment.rawText),
    revisionId: segment.revisionId,
    author: segment.author,
    date: segment.date,
    rangeId: segment.rangeId,
    rangeName: segment.rangeName,
    rangeAuthor: segment.rangeAuthor,
    rangeDate: segment.rangeDate,
    status: segment.status,
    reason: segment.reason,
    pairId: null,
    location: 'body',
    anchorPageNumber: null,
    headerFooterRefType: null,
    sourceRelationshipId: null,
    sourceChangeIndex: null,
    applyTarget: 'pm',
    sourceParagraphId: null,
    sourceParagraphChangeKind: null,
    sourceParagraphChangeIndex: null,
  }));

  markMovePairing(revisions);

  revisions.sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));

  return revisions;
}

interface BodyParagraphRange {
  from: number;
  to: number;
}

function collectBodyParagraphRanges(doc: PMNode): Map<string, BodyParagraphRange> {
  const ranges = new Map<string, BodyParagraphRange>();

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const paraId = normalizeString((node.attrs as { paraId?: unknown } | null)?.paraId);
    if (!paraId || ranges.has(paraId)) return true;

    const from = pos + 1;
    const to = Math.max(from + 1, pos + node.nodeSize - 1);
    ranges.set(paraId, { from, to });
    return true;
  });

  return ranges;
}

function paragraphToRawText(paragraph: Paragraph): string {
  let text = '';

  for (const item of paragraph.content) {
    if (item.type === 'run') {
      for (const chunk of item.content) {
        text += runContentToText(chunk);
      }
      continue;
    }

    if (item.type === 'hyperlink') {
      for (const child of item.children) {
        if (child.type !== 'run') continue;
        for (const chunk of child.content) {
          text += runContentToText(chunk);
        }
      }
      continue;
    }
  }

  return text;
}

function collectParagraphsFromBlocks(
  blocks: Array<Paragraph | Table | BlockSdt>,
  out: Paragraph[]
): void {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      out.push(block);
      continue;
    }

    if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectParagraphsFromBlocks(cell.content as Array<Paragraph | Table | BlockSdt>, out);
        }
      }
      continue;
    }

    if (block.type === 'blockSdt') {
      collectParagraphsFromBlocks(block.content as Array<Paragraph | Table | BlockSdt>, out);
    }
  }
}

function sectionBreakPreviewLabel(paragraph: Paragraph): string | null {
  const sectionStart = paragraph.sectionProperties?.sectionStart;
  if (!sectionStart) return null;
  if (sectionStart === 'nextPage') return 'Section break (next page)';
  if (sectionStart === 'continuous') return 'Section break (continuous)';
  if (sectionStart === 'oddPage') return 'Section break (odd page)';
  if (sectionStart === 'evenPage') return 'Section break (even page)';
  return null;
}

function extractBodyDocumentModelRevisions(
  doc: PMNode,
  documentModel: Document | null
): ReviewRevisionItem[] {
  if (!documentModel?.package?.document) return [];

  const paragraphRanges = collectBodyParagraphRanges(doc);
  const paragraphs: Paragraph[] = [];
  collectParagraphsFromBlocks(
    documentModel.package.document.content as Array<Paragraph | Table | BlockSdt>,
    paragraphs
  );

  const revisions: ReviewRevisionItem[] = [];
  let sequence = 0;

  for (const paragraph of paragraphs) {
    const paraId = normalizeString(paragraph.paraId);
    if (!paraId) continue;
    const range = paragraphRanges.get(paraId);
    if (!range) continue;

    const paragraphPreview = sanitizePreview(paragraphToRawText(paragraph));

    if (paragraph.paragraphPropertiesChange) {
      const change = paragraph.paragraphPropertiesChange;
      revisions.push({
        id: `bodymodel:ppr:${paraId}:${change.info.id}:${sequence}`,
        type: 'formatChange',
        from: range.from,
        to: range.to,
        textPreview: sanitizePreview(`Paragraph formatting change: ${paragraphPreview}`),
        revisionId: change.info.id,
        author: normalizeString(change.info.author) ?? 'Unknown',
        date: normalizeString(change.info.date),
        rangeId: null,
        rangeName: null,
        rangeAuthor: null,
        rangeDate: null,
        status: 'supported',
        reason: null,
        pairId: null,
        location: 'body',
        anchorPageNumber: null,
        headerFooterRefType: null,
        sourceRelationshipId: null,
        sourceChangeIndex: null,
        applyTarget: 'documentModel',
        sourceParagraphId: paraId,
        sourceParagraphChangeKind: 'paragraphProperties',
        sourceParagraphChangeIndex: 0,
      });
      sequence += 1;
    }

    const paragraphMarkMoveRevisions = paragraph.paragraphMarkMoveRevisions ?? [];
    for (let index = 0; index < paragraphMarkMoveRevisions.length; index += 1) {
      const moveRevision = paragraphMarkMoveRevisions[index]!;
      const sectionLabel = sectionBreakPreviewLabel(paragraph);
      const movePreview = sectionLabel
        ? `Paragraph mark move: ${sectionLabel}`
        : 'Paragraph mark move';

      revisions.push({
        id: `bodymodel:pmove:${paraId}:${moveRevision.info.id}:${moveRevision.type}:${index}`,
        type: moveRevision.type,
        from: range.from,
        to: range.to,
        textPreview: movePreview,
        revisionId: moveRevision.info.id,
        author: normalizeString(moveRevision.info.author) ?? 'Unknown',
        date: normalizeString(moveRevision.info.date),
        rangeId: null,
        rangeName: null,
        rangeAuthor: null,
        rangeDate: null,
        status: 'unsupported',
        reason: PARAGRAPH_MARK_MOVE_READONLY_REASON,
        pairId: null,
        location: 'body',
        anchorPageNumber: null,
        headerFooterRefType: null,
        sourceRelationshipId: null,
        sourceChangeIndex: null,
        applyTarget: 'documentModel',
        sourceParagraphId: paraId,
        sourceParagraphChangeKind:
          moveRevision.type === 'moveFrom' ? 'paragraphMarkMoveFrom' : 'paragraphMarkMoveTo',
        sourceParagraphChangeIndex: index,
      });
    }
  }

  return revisions;
}

type HeaderFooterLocation = 'header' | 'footer';

interface HeaderFooterTrackedChange {
  type: ReviewRevisionType;
  info: TrackedChangeInfo;
  range: MoveRangeInfo | undefined;
  content: Array<Run | Hyperlink>;
}

function normalizeHeaderFooterRefType(
  value: HeaderReference['type'] | FooterReference['type']
): ReviewHeaderFooterReferenceType {
  if (value === 'first' || value === 'even') return value;
  return 'default';
}

function anchorPageForRefType(
  refType: ReviewHeaderFooterReferenceType,
  hasFirst: boolean,
  hasEven: boolean,
  sectionStartPage: number
): number {
  if (refType === 'first') return Math.max(1, sectionStartPage);
  if (refType === 'even') return Math.max(1, sectionStartPage + 1);

  if (hasFirst && hasEven) return Math.max(1, sectionStartPage + 2);
  if (hasFirst) return Math.max(1, sectionStartPage + 1);
  return Math.max(1, sectionStartPage);
}

function runContentToText(content: RunContent): string {
  switch (content.type) {
    case 'text':
    case 'instrText':
      return content.text;
    case 'tab':
      return '\t';
    case 'break':
      return '\n';
    case 'symbol':
      return content.char;
    case 'softHyphen':
    case 'noBreakHyphen':
      return '-';
    case 'drawing':
      return '<image>';
    case 'shape':
      return '<shape>';
    case 'footnoteRef':
    case 'endnoteRef':
      return `<${content.type}>`;
    case 'fieldChar':
      return '';
  }
}

function trackedItemsToRawText(items: Array<Run | Hyperlink>): string {
  let text = '';

  for (const item of items) {
    if (item.type === 'run') {
      for (const chunk of item.content) {
        text += runContentToText(chunk);
      }
      continue;
    }

    for (const child of item.children) {
      if (child.type !== 'run') continue;
      for (const chunk of child.content) {
        text += runContentToText(chunk);
      }
    }
  }

  return text;
}

function collectTrackedChangesFromParagraphContent(
  paragraphContent: ParagraphContent[],
  out: HeaderFooterTrackedChange[]
): void {
  for (const item of paragraphContent) {
    if (
      item.type === 'insertion' ||
      item.type === 'deletion' ||
      item.type === 'moveFrom' ||
      item.type === 'moveTo'
    ) {
      out.push({
        type: item.type,
        info: item.info,
        range: item.type === 'moveFrom' || item.type === 'moveTo' ? item.range : undefined,
        content: item.content,
      });
    }
  }
}

function collectTrackedChangesFromBlocks(
  blocks: Array<Paragraph | Table>,
  out: HeaderFooterTrackedChange[]
): void {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      collectTrackedChangesFromParagraphContent(block.content, out);
      continue;
    }

    if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectTrackedChangesFromBlocks(cell.content, out);
        }
      }
    }
  }
}

function extractHeaderFooterRevisions(documentModel: Document | null): ReviewRevisionItem[] {
  if (!documentModel?.package?.document) return [];

  const pkg = documentModel.package;
  const result: ReviewRevisionItem[] = [];
  const sectionSources =
    pkg.document.sections && pkg.document.sections.length > 0
      ? pkg.document.sections.map((section, index) => ({
          properties: section.properties,
          sectionStartPage: index + 1,
        }))
      : pkg.document.finalSectionProperties
        ? [{ properties: pkg.document.finalSectionProperties, sectionStartPage: 1 }]
        : [];

  if (sectionSources.length === 0) return [];

  const seenReferences = new Set<string>();

  const consume = (
    location: HeaderFooterLocation,
    refs: Array<HeaderReference | FooterReference>,
    hasFirst: boolean,
    hasEven: boolean,
    sectionStartPage: number
  ) => {
    const sourceMap = location === 'header' ? pkg.headers : pkg.footers;
    if (!sourceMap || refs.length === 0) return;

    let index = 0;
    for (const ref of refs) {
      const refType = normalizeHeaderFooterRefType(ref.type);
      const refKey = `${location}:${ref.rId}`;
      if (seenReferences.has(refKey)) continue;
      seenReferences.add(refKey);

      const source = sourceMap.get(ref.rId);
      if (!source) continue;

      const tracked: HeaderFooterTrackedChange[] = [];
      collectTrackedChangesFromBlocks(source.content, tracked);
      const anchorPageNumber = anchorPageForRefType(refType, hasFirst, hasEven, sectionStartPage);

      for (const change of tracked) {
        const rangeId = change.range?.id ?? null;
        const rangeName = normalizeString(change.range?.name);
        const rangeKey = rangeId === null ? 'na' : String(rangeId);
        const id = `hf:${location}:${ref.rId}:${refType}:${change.type}:${change.info.id}:${rangeKey}:${index}`;
        const sourceChangeIndex = index;
        index += 1;

        const moveWithoutRange =
          (change.type === 'moveFrom' || change.type === 'moveTo') &&
          rangeId === null &&
          rangeName === null;
        const status = moveWithoutRange ? 'unsupported' : 'supported';
        const reason = moveWithoutRange ? HEADER_FOOTER_MISSING_MOVE_RANGE_REASON : null;

        result.push({
          id,
          type: change.type,
          from: 0,
          to: 0,
          textPreview: sanitizePreview(trackedItemsToRawText(change.content)),
          revisionId: change.info.id,
          author: normalizeString(change.info.author) ?? 'Unknown',
          date: normalizeString(change.info.date),
          rangeId,
          rangeName,
          rangeAuthor: normalizeString(change.range?.author),
          rangeDate: normalizeString(change.range?.date),
          status,
          reason,
          pairId: null,
          location,
          anchorPageNumber,
          headerFooterRefType: refType,
          sourceRelationshipId: ref.rId,
          sourceChangeIndex,
          applyTarget: 'documentModel',
          sourceParagraphId: null,
          sourceParagraphChangeKind: null,
          sourceParagraphChangeIndex: null,
        });
      }
    }
  };

  for (const sectionSource of sectionSources) {
    const headerRefs = sectionSource.properties.headerReferences ?? [];
    const footerRefs = sectionSource.properties.footerReferences ?? [];
    const hasFirstHeader = headerRefs.some((ref) => ref.type === 'first');
    const hasEvenHeader = headerRefs.some((ref) => ref.type === 'even');
    const hasFirstFooter = footerRefs.some((ref) => ref.type === 'first');
    const hasEvenFooter = footerRefs.some((ref) => ref.type === 'even');

    consume('header', headerRefs, hasFirstHeader, hasEvenHeader, sectionSource.sectionStartPage);
    consume('footer', footerRefs, hasFirstFooter, hasEvenFooter, sectionSource.sectionStartPage);
  }

  return result;
}

export function findActiveRevisionId(
  revisions: readonly ReviewRevisionItem[],
  from: number,
  to: number
): string | null {
  if (revisions.length === 0) return null;

  const isCollapsed = from === to;
  const matches = revisions.filter((revision) => {
    if (revision.location !== 'body') return false;
    if (isCollapsed) {
      return revision.from <= from && from < revision.to;
    }
    return revision.to > from && revision.from < to;
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const lenA = a.to - a.from;
    const lenB = b.to - b.from;
    return lenA - lenB || a.from - b.from;
  });

  return matches[0]?.id ?? null;
}

export function createReviewPluginState(
  doc: PMNode,
  selectionFrom: number,
  selectionTo: number,
  documentModel: Document | null = null
): ReviewPluginState {
  const bodyMarkRevisions = extractRevisionsFromDoc(doc);
  const bodyModelRevisions = extractBodyDocumentModelRevisions(doc, documentModel);
  const headerFooterRevisions = extractHeaderFooterRevisions(documentModel);
  const revisions = [...bodyMarkRevisions, ...bodyModelRevisions, ...headerFooterRevisions].sort(
    (a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id)
  );
  const activeRevisionId = findActiveRevisionId(revisions, selectionFrom, selectionTo);
  const supportedCount = revisions.filter((revision) => revision.status === 'supported').length;

  return {
    revisions,
    activeRevisionId,
    totalCount: revisions.length,
    supportedCount,
    unsupportedCount: revisions.length - supportedCount,
  };
}
