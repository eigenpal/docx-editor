// Random edits for the scenario oracles to check.
//
// An edit addresses paragraphs and nodes by document position, not by ID, so a replay binds
// it to whatever IDs the replica holds and a shrunk action list stays meaningful.

import {
  bindNodeIds,
  planStructureEdit,
  STRUCTURE_WEIGHTS,
  type NodeAddressed,
  type StructureEditKind,
} from './structure-edits.ts';
import {
  addPackageComment,
  paragraphTextOf,
  type StoryScope,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import { elements, parentOf, textOf } from './scenario-tree.ts';

const BODY: StoryScope = { kind: 'body' };

/** Ops a story transaction refuses: they change parts, so the package applies them. */
const PACKAGE_OPS: ReadonlySet<string> = new Set([
  'insertNote',
  'deleteNote',
  'convertNote',
  'convertAllNotes',
  'setNoteProperties',
  'createHeaderFooter',
  'deleteHeaderFooter',
  'linkToPrevious',
  'unlinkFromPrevious',
  'setSectionFurnitureOptions',
  'setDocumentProtection',
]);

export type EditKind =
  | 'type'
  | 'delete'
  | 'split'
  | 'join'
  | 'format'
  | 'paragraphFormat'
  | 'tab'
  | 'break'
  | 'deleteParagraph'
  | 'insertRow'
  | 'deleteRow'
  | StructureEditKind;

export const DEFAULT_WEIGHTS: Record<EditKind, number> = {
  type: 40,
  delete: 15,
  split: 6,
  join: 5,
  format: 12,
  paragraphFormat: 4,
  tab: 2,
  break: 2,
  deleteParagraph: 3,
  insertRow: 2,
  deleteRow: 1,
  ...STRUCTURE_WEIGHTS,
};

/** Operations in document coordinates: paragraph, table, and row indexes, not node ids. */
export type Addressed =
  | { readonly kind: 'paragraph'; readonly op: TreeDocOp; readonly paragraphs: number[] }
  | { readonly kind: 'row'; readonly op: TreeDocOp; readonly table: number; readonly row: number }
  | NodeAddressed;

export function bindIds(store: TreePackageStore, addressed: Addressed): TreeDocOp | null {
  const root = store.bodyStore().part.root;
  if (addressed.kind === 'node') return bindNodeIds(root, addressed);
  if (addressed.kind === 'paragraph') {
    const paragraphs = elements(root, 'p');
    const ids = addressed.paragraphs.map((index) => paragraphs[index]?.id);
    if (ids.some((id) => id === undefined)) return null;
    const op = { ...addressed.op } as Record<string, unknown>;
    if ('paragraphId' in op) op.paragraphId = ids[0];
    if ('blockId' in op) op.blockId = ids[0];
    if ('beforeParagraphId' in op) op.beforeParagraphId = ids[0];
    if ('firstId' in op) {
      op.firstId = ids[0];
      op.secondId = ids[1];
    }
    return op as unknown as TreeDocOp;
  }
  const table = elements(root, 'tbl')[addressed.table];
  const row = table ? elements(table, 'tr')[addressed.row] : undefined;
  if (!table || !row) return null;
  return { ...addressed.op, tableId: table.id, rowId: row.id } as TreeDocOp;
}

/** What participants type, by code point: one emoji is two UTF-16 units. */
const TYPED = [...'lorem ipsum \u{1F600} dolor sit \u{1F603}\u{1F200} amet '];

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

export const RUN_PROPERTIES = ['b', 'i', 'u', 'strike'] as const;

export function planEdit(
  store: TreePackageStore,
  random: () => number,
  weights: Record<EditKind, number>
): Addressed | null {
  const root = store.bodyStore().part.root;
  const paragraphs = elements(root, 'p');
  if (paragraphs.length === 0) return null;
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0) as [
    EditKind,
    number,
  ][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  let kind: EditKind = 'type';
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll < 0) {
      kind = name;
      break;
    }
  }
  // Favor a few paragraphs, so replicas meet in the same text often.
  const pick = Math.floor(random() ** 2 * Math.min(paragraphs.length, 12));
  const paragraph = paragraphs[pick]!;
  const value = paragraphTextOf(store.bodyStore().part, paragraph.id) ?? textOf(paragraph);
  const length = value.length;
  // An offset inside a surrogate pair moves to the pair's start, and the end of a range to the
  // pair's end: the store refuses to split one.
  const inside = (at: number): boolean =>
    at > 0 && at < length && isLowSurrogate(value.charCodeAt(at));
  const boundary = (at: number): number => (inside(at) ? at - 1 : at);
  const endBoundary = (at: number): number => (inside(at) ? at + 1 : at);
  const offset = boundary(Math.floor(random() * (length + 1)));
  const span = 1 + Math.floor(random() * 6);
  const at = (op: Record<string, unknown>, extra: number[] = []): Addressed => ({
    kind: 'paragraph',
    op: { paragraphId: '', ...op } as unknown as TreeDocOp,
    paragraphs: [pick, ...extra],
  });
  switch (kind) {
    case 'type': {
      // Typed text holds characters outside the basic plane too. Where it starts in the source
      // follows the offset, so a seed draws the same numbers as before.
      const count = 1 + Math.floor(random() * 4);
      const start = offset % TYPED.length;
      const text = [...TYPED, ...TYPED].slice(start, start + count).join('');
      return at({ op: 'insertText', offset, text });
    }
    case 'delete':
      return length === 0
        ? null
        : at({
            op: 'deleteText',
            start: boundary(Math.min(offset, length - 1)),
            end: endBoundary(Math.min(length, offset + span)),
          });
    case 'split':
      return at({ op: 'splitParagraph', offset });
    case 'join': {
      // Join only true siblings: the store refuses anything else, by design.
      const parent = parentOf(root, paragraph.id);
      if (!parent || parent.kind === 'textValue') return null;
      const at2 = parent.children.findIndex((child) => child.id === paragraph.id);
      const next = parent.children[at2 + 1];
      if (!next || next.kind !== 'paragraph') return null;
      const nextIndex = paragraphs.findIndex((p) => p.id === next.id);
      return {
        kind: 'paragraph',
        op: { op: 'joinParagraphs', firstId: '', secondId: '' },
        paragraphs: [pick, nextIndex],
      };
    }
    case 'format': {
      if (length === 0) return null;
      const start = boundary(Math.min(offset, length - 1));
      const property = RUN_PROPERTIES[Math.floor(random() * RUN_PROPERTIES.length)]!;
      return at({
        op: 'setRunProperties',
        start,
        end: endBoundary(Math.min(length, start + span * 2)),
        properties: random() < 0.2 ? [] : [{ localName: property }],
      });
    }
    case 'paragraphFormat': {
      const values = ['left', 'center', 'right', 'both'];
      return at({
        op: 'setParagraphProperties',
        properties: [
          { localName: 'jc', attributes: { val: values[Math.floor(random() * values.length)]! } },
        ],
      });
    }
    case 'tab':
      return at({ op: 'insertTab', offset });
    case 'break':
      return at({ op: 'insertHardBreak', offset });
    case 'deleteParagraph':
      // Keep the document from emptying out.
      return paragraphs.length > 4 && parentOf(root, paragraph.id)?.kind !== 'textValue'
        ? at({ op: 'deleteBlock', blockId: '' })
        : null;
    case 'insertRow':
    case 'deleteRow': {
      const tables = elements(root, 'tbl');
      if (tables.length === 0) return null;
      const table = Math.floor(random() * tables.length);
      const rows = elements(tables[table]!, 'tr');
      if (rows.length === 0 || (kind === 'deleteRow' && rows.length < 2)) return null;
      const row = Math.floor(random() * rows.length);
      return {
        kind: 'row',
        table,
        row,
        op:
          kind === 'insertRow'
            ? ({
                op: 'insertTableRow',
                tableId: '',
                rowId: '',
                where: random() < 0.5 ? 'above' : 'below',
              } as TreeDocOp)
            : ({ op: 'deleteTableRow', tableId: '', rowId: '' } as TreeDocOp),
      };
    }
    default: {
      const planned = planStructureEdit(kind, {
        root,
        random,
        offset,
        length,
        span,
        boundary,
        endBoundary,
      });
      if (!planned) return null;
      return 'paragraphOp' in planned ? at(planned.paragraphOp) : planned;
    }
  }
}

/**
 * Apply one bound edit as the editor would. Notes and headers change parts and relationships,
 * so the package applies them; a comment is the pseudo-op `addComment`, written through the
 * package's comment write; everything else is a story transaction.
 */
export function applyOp(
  store: TreePackageStore,
  op: TreeDocOp,
  actorId: string
): { readonly ok: boolean; readonly reason?: string } {
  const loose = op as unknown as { op: string; paragraphId: string; start: number; end: number };
  if (loose.op === 'addComment') {
    const result = addPackageComment(store, {
      anchor: { paragraphId: loose.paragraphId, start: loose.start, end: loose.end },
      author: 'Fuzzer',
      text: 'comment',
      actorId,
    });
    return result.ok ? { ok: true } : { ok: false, reason: String(result.reason) };
  }
  // The editor binds its collaboration actor to every write, so ids it mints are striped by
  // author: two people who add the first note at once do not mint the same `rId`.
  if (PACKAGE_OPS.has(op.op)) return store.applyLifecycleOp(op, { actorId });
  return store.transact(BODY, (context) => context.apply(op), { actorId });
}
