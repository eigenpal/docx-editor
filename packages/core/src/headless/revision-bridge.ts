import { revisionGroupKey } from '../store/store/tree-op-revisions.ts';
import type { RevisionAddress } from '../store/store/tree-op-types.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { noteIdOf, noteKindOf } from '../store/package/note-nodes.ts';

export type RevisionStory =
  | { readonly kind: 'body' }
  | { readonly kind: 'footnote' | 'endnote'; readonly noteId: number };

export interface CanonicalRevisionRef {
  readonly story: RevisionStory;
  readonly nodeId: string;
  readonly type: 'insertion' | 'deletion' | 'moveFrom' | 'moveTo';
  readonly address: RevisionAddress;
  /** Named move pair key from range markers, when present. */
  readonly moveName?: string;
}

export interface RevisionIndexEntry {
  readonly syntheticId: number;
  readonly ref: CanonicalRevisionRef;
  readonly paragraphIndex: number;
  readonly revisionRef: string;
}

export interface RevisionIndex {
  readonly entries: readonly RevisionIndexEntry[];
  entryBySyntheticId(id: number): RevisionIndexEntry | undefined;
  entryByRevisionRef(ref: string): RevisionIndexEntry | undefined;
  entriesByMoveName(story: RevisionStory, moveName: string): readonly RevisionIndexEntry[];
}

export interface NoteParagraphIds {
  readonly footnotes: ReadonlyMap<number, readonly string[]>;
  readonly endnotes: ReadonlyMap<number, readonly string[]>;
}

const REVISION_KINDS = new Set([
  'revisionInsert',
  'revisionDelete',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

function wmlAttr(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return undefined;
}

function revisionAddress(node: OoxmlNode): RevisionAddress | null {
  if (node.kind === 'textValue') return null;
  const id = wmlAttr(node, 'id');
  const author = wmlAttr(node, 'author');
  if (id === undefined || author === undefined) return null;
  const date = wmlAttr(node, 'date');
  return date === undefined ? { id, author } : { id, author, date };
}

function revisionType(node: OoxmlNode): CanonicalRevisionRef['type'] | null {
  switch (node.kind) {
    case 'revisionInsert':
      return 'insertion';
    case 'revisionDelete':
      return 'deletion';
    case 'revisionMoveFrom':
      return 'moveFrom';
    case 'revisionMoveTo':
      return 'moveTo';
    default:
      return null;
  }
}

function storyKey(story: RevisionStory): string {
  return story.kind === 'body' ? 'body' : `${story.kind}:${story.noteId}`;
}

function revisionLocalName(type: CanonicalRevisionRef['type']): string {
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

function logicalRevisionKey(ref: CanonicalRevisionRef, paragraphIndex: number): string {
  return `${storyKey(ref.story)}\u0000${paragraphIndex}\u0000${ref.type}\u0000${revisionGroupKey(ref.address, revisionLocalName(ref.type))}`;
}

function paragraphIdsByNoteInPart(part: OoxmlPart): Map<number, string[]> {
  const byNote = new Map<number, string[]>();
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    const noteKind = noteKindOf(child);
    if (noteKind === undefined) continue;
    const noteId = noteIdOf(child);
    if (noteId === null || noteId === undefined) continue;
    const ids: string[] = [];
    for (const block of child.children) {
      if (block.kind === 'paragraph') ids.push(block.id);
      else if (block.kind === 'table') {
        for (const row of block.children) {
          if (row.kind !== 'tableRow') continue;
          for (const cell of row.children) {
            if (cell.kind !== 'tableCell') continue;
            for (const inner of cell.children) {
              if (inner.kind === 'paragraph') ids.push(inner.id);
            }
          }
        }
      }
    }
    byNote.set(noteId, ids);
  }
  return byNote;
}

export function collectNoteParagraphIds(pkg: OoxmlPackage): NoteParagraphIds {
  const footnotes = pkg.parts.get('/word/footnotes.xml');
  const endnotes = pkg.parts.get('/word/endnotes.xml');
  return Object.freeze({
    footnotes: footnotes ? paragraphIdsByNoteInPart(footnotes) : new Map(),
    endnotes: endnotes ? paragraphIdsByNoteInPart(endnotes) : new Map(),
  });
}

interface MoveRangeState {
  readonly name: string;
}

function buildIndexForPart(part: OoxmlPart, story: RevisionStory): RevisionIndexEntry[] {
  const wrappers: Array<{ ref: CanonicalRevisionRef; paragraphIndex: number }> = [];
  const openRanges: MoveRangeState[] = [];
  let paragraphIndex = -1;

  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') paragraphIndex += 1;

    if (node.kind === 'moveFromRangeStart' || node.kind === 'moveToRangeStart') {
      const name = wmlAttr(node, 'name');
      if (name !== undefined) openRanges.push({ name });
    } else if (node.kind === 'moveFromRangeEnd' || node.kind === 'moveToRangeEnd') {
      openRanges.pop();
    }

    if (REVISION_KINDS.has(node.kind)) {
      const address = revisionAddress(node);
      const type = revisionType(node);
      if (address && type) {
        const moveName = openRanges[openRanges.length - 1]?.name;
        wrappers.push({
          ref: {
            story,
            nodeId: node.id,
            type,
            address,
            ...(moveName === undefined ? {} : { moveName }),
          },
          paragraphIndex: Math.max(paragraphIndex, 0),
        });
      }
    }

    for (const child of node.children) visit(child);
  };

  visit(part.root);

  const grouped = new Map<string, RevisionIndexEntry>();
  const usedSynthetic = new Set<number>();
  let nextSynthetic = 1;
  const allocateSynthetic = (authoredId: number): number => {
    if (!usedSynthetic.has(authoredId)) {
      usedSynthetic.add(authoredId);
      nextSynthetic = Math.max(nextSynthetic, authoredId + 1);
      return authoredId;
    }
    while (usedSynthetic.has(nextSynthetic)) nextSynthetic += 1;
    const id = nextSynthetic;
    usedSynthetic.add(id);
    nextSynthetic += 1;
    return id;
  };

  for (const wrapper of wrappers) {
    const key = logicalRevisionKey(wrapper.ref, wrapper.paragraphIndex);
    const existing = grouped.get(key);
    if (existing) continue;
    const syntheticId = allocateSynthetic(
      Number.parseInt(wrapper.ref.address.id, 10) || nextSynthetic
    );
    grouped.set(key, {
      syntheticId,
      ref: wrapper.ref,
      paragraphIndex: wrapper.paragraphIndex,
      revisionRef: key,
    });
  }

  return [...grouped.values()];
}

class RevisionIndexImpl implements RevisionIndex {
  readonly entries: readonly RevisionIndexEntry[];
  private readonly byId = new Map<number, RevisionIndexEntry>();
  private readonly byRef = new Map<string, RevisionIndexEntry>();
  private readonly byMove = new Map<string, RevisionIndexEntry[]>();

  constructor(entries: readonly RevisionIndexEntry[]) {
    this.entries = Object.freeze([...entries]);
    for (const entry of entries) {
      this.byId.set(entry.syntheticId, entry);
      this.byRef.set(entry.revisionRef, entry);
      const moveName = entry.ref.moveName;
      if (moveName !== undefined) {
        const key = `${storyKey(entry.ref.story)}\u0000${moveName}`;
        const bucket = this.byMove.get(key) ?? [];
        bucket.push(entry);
        this.byMove.set(key, bucket);
      }
    }
  }

  entryBySyntheticId(id: number): RevisionIndexEntry | undefined {
    return this.byId.get(id);
  }

  entryByRevisionRef(ref: string): RevisionIndexEntry | undefined {
    return this.byRef.get(ref);
  }

  entriesByMoveName(story: RevisionStory, moveName: string): readonly RevisionIndexEntry[] {
    return this.byMove.get(`${storyKey(story)}\u0000${moveName}`) ?? [];
  }
}

export function buildRevisionIndex(pkg: OoxmlPackage): RevisionIndex {
  const entries: RevisionIndexEntry[] = [];
  const main = pkg.parts.get('/word/document.xml');
  if (main) {
    entries.push(...buildIndexForPart(main, { kind: 'body' }));
  }
  const noteIds = collectNoteParagraphIds(pkg);
  const footnotes = pkg.parts.get('/word/footnotes.xml');
  if (footnotes) {
    for (const [noteId] of noteIds.footnotes) {
      const noteNode = footnotes.root.children.find(
        (child) => child.kind !== 'textValue' && noteIdOf(child) === noteId
      );
      if (noteNode && noteNode.kind !== 'textValue') {
        entries.push(
          ...buildIndexForPart({ ...footnotes, root: noteNode }, { kind: 'footnote', noteId })
        );
      }
    }
  }
  const endnotes = pkg.parts.get('/word/endnotes.xml');
  if (endnotes) {
    for (const [noteId] of noteIds.endnotes) {
      const noteNode = endnotes.root.children.find(
        (child) => child.kind !== 'textValue' && noteIdOf(child) === noteId
      );
      if (noteNode && noteNode.kind !== 'textValue') {
        entries.push(
          ...buildIndexForPart({ ...endnotes, root: noteNode }, { kind: 'endnote', noteId })
        );
      }
    }
  }
  return new RevisionIndexImpl(entries);
}
