/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Flattens a story's block content into comparable units.
 *
 * A paragraph becomes a list of atoms: one per UTF-16 code unit of text, one per inline
 * object (tab, break, drawing, field character, note reference, ...). Each atom keeps the
 * serialized run properties and the inline wrappers (hyperlink, content control, simple
 * field) it sits in, so the emitter can rebuild runs from either side.
 */
import type { OoxmlNode, OoxmlPackage } from '@docx-editor.dev/core/store';
import { relationshipsOf } from '@docx-editor.dev/core/store';
import { textBoxesOf, withBoxMarkers } from './text-boxes.ts';
import {
  attributeOf,
  childNamed,
  elementChildren,
  innerOf,
  isElement,
  withInheritedBindings,
  shellOf,
  R_NS,
  type ElementNode,
  type NamespaceScope,
} from './xml-fragments.ts';

export type SideName = 'base' | 'revised';

export interface Wrapper {
  /** Identity used in token keys; includes resolved link targets. */
  readonly key: string;
  readonly start: string;
  readonly end: string;
}

export interface Atom {
  readonly kind: 'char' | 'object';
  /** The code unit for a char atom; the object placeholder for an object atom. */
  readonly text: string;
  /** Serialized object element (object atoms). */
  readonly xml: string;
  /** Serialized object element as it must appear inside `w:del`. */
  readonly delXml: string;
  /** Comparison key of an object atom. */
  readonly key: string;
  /** Inner XML of the run's `w:rPr` ('' when none). */
  readonly rPr: string;
  readonly wrappers: readonly Wrapper[];
  /** Zero-width range markers (bookmarks, comment ranges) that precede this atom. */
  readonly markers: readonly string[];
  /** The note a footnote or endnote reference points at. */
  readonly note?: { readonly kind: 'footnote' | 'endnote'; readonly id: string };
  /** The object element, kept when it holds text boxes (compared as stories). */
  readonly node?: ElementNode;
}

export interface ParagraphUnit {
  readonly kind: 'paragraph';
  readonly side: SideName;
  readonly node: ElementNode;
  /** Serialized `w:pPr` children other than `rPr`, `sectPr`, `pPrChange`. */
  readonly pPr: readonly string[];
  /** Inner XML of the paragraph mark's `w:rPr`. */
  readonly markRPr: string;
  /** The paragraph's own section break, if any. */
  readonly sectPr: ElementNode | null;
  readonly atoms: readonly Atom[];
  /** Markers after the last atom. */
  readonly trailingMarkers: readonly string[];
  /** Level-one alignment key: text plus object keys. */
  readonly key: string;
}

export interface BlockUnit {
  readonly kind: 'table' | 'sdt' | 'opaque';
  readonly side: SideName;
  readonly node: ElementNode;
  readonly key: string;
}

export type Unit = ParagraphUnit | BlockUnit;

export const OBJECT_TEXT = '￼';

/** Id placeholder of a comment taken from the revised document. */
export const commentPlaceholder = (id: string) => `§CMT:${id}§`;

/**
 * Candidate relationship-valued attributes. The serializer chooses its own prefixes, so the
 * prefix is checked against the relationships namespace before the value counts as an id.
 */
const REL_ATTRIBUTE = /(\b([A-Za-z_][\w.-]*):(?:id|embed|link|pict|href|dm|lo|qs|cs)=")([^"]+)"/g;
/**
 * Revised-side relationship ids are written as `§REL:<revised owner part>|<id>§` and resolved
 * on assembly against the output part that holds the fragment.
 */
export const REL_PLACEHOLDER = '§REL:';

const MARKERS = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
]);

/** Inline elements that are dropped: proofing state and layout caches. */
const DROPPED = new Set(['proofErr', 'lastRenderedPageBreak', 'noProof']);

/** Inline wrappers whose content is flattened into atoms. */
const WRAPPERS = new Set(['hyperlink', 'sdt', 'fldSimple', 'smartTag', 'customXml', 'dir', 'bdo']);

/** Per-side context: relationship resolution and serialization. */
export class SideContext {
  readonly #rels: ReadonlyMap<string, { type: string; target: string; external: boolean }>;
  readonly #mediaKeys = new Map<string, string>();

  constructor(
    readonly name: SideName,
    readonly pkg: OoxmlPackage,
    readonly partName: string,
    readonly scope: NamespaceScope
  ) {
    this.#rels = new Map([
      ...relationshipsOf(pkg, partName).map(
        (record) =>
          [
            record.id,
            {
              type: record.type,
              target: record.rawTarget,
              external: record.targetMode === 'External',
            },
          ] as const
      ),
      ...pkg.externalTargets
        .filter((record) => record.ownerPart === partName)
        .map(
          (record) =>
            [record.id, { type: record.type, target: record.rawTarget, external: true }] as const
        ),
    ]);
  }

  /** A stable, side-independent identity for a relationship id. */
  relKey(id: string): string {
    const rel = this.#rels.get(id);
    if (!rel) return `missing:${id}`;
    if (rel.external) return `${rel.type}|${rel.target}`;
    let key = this.#mediaKeys.get(id);
    if (key === undefined) {
      const dir = this.partName.slice(0, this.partName.lastIndexOf('/') + 1);
      const target = rel.target.startsWith('/') ? rel.target : normalizePath(dir + rel.target);
      const bytes = this.pkg.partBytes.get(target) ?? this.pkg.partBytes.get(target.slice(1));
      key = `${rel.type}|${bytes ? fnv(bytes) : target}`;
      this.#mediaKeys.set(id, key);
    }
    return key;
  }

  /** Serialized node, with relationship ids as written. */
  raw(node: OoxmlNode): string {
    const root = this.pkg.parts.get(this.partName)?.root;
    return this.scope.serialize(
      withInheritedBindings(node, root && isElement(root) ? root.namespaceBindings : [])
    );
  }

  /** Serialized node; revised-side relationship ids become import placeholders. */
  serialize(node: OoxmlNode): string {
    return this.remap(this.raw(node));
  }

  remap(xml: string): string {
    if (this.name === 'base') return xml;
    return xml.replace(REL_ATTRIBUTE, (whole, lead: string, prefix: string, id: string) =>
      this.#isRelationshipPrefix(prefix, xml)
        ? `${lead}${REL_PLACEHOLDER}${this.partName}|${id}§"`
        : whole
    );
  }

  /** Key of a raw serialized fragment, with relationship ids resolved to their targets. */
  keyOf(raw: string): string {
    return raw.replace(REL_ATTRIBUTE, (whole, lead: string, prefix: string, id: string) =>
      this.#isRelationshipPrefix(prefix, raw) ? `${lead}${this.relKey(id)}"` : whole
    );
  }

  /** Whether `prefix` names the relationships namespace in `xml` or in the root scope. */
  #isRelationshipPrefix(prefix: string, xml: string): boolean {
    const local = new RegExp(`\\sxmlns:${prefix}="([^"]*)"`).exec(xml);
    return (local ? local[1] : this.scope.uriOf(prefix)) === R_NS;
  }
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const piece of path.split('/')) {
    if (piece === '..') out.pop();
    else if (piece !== '.' && piece !== '') out.push(piece);
  }
  return `/${out.join('/')}`;
}

function fnv(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `${bytes.length}:${hash.toString(16)}`;
}

/** Units of a block container (`w:body`, `w:tc`, `w:sdtContent`, ...). */
export function unitsOf(container: OoxmlNode, side: SideContext): Unit[] {
  const units: Unit[] = [];
  for (const child of elementChildren(container)) {
    switch (child.localName) {
      case 'p':
        units.push(paragraphUnit(child, side));
        break;
      case 'tbl':
        units.push({ kind: 'table', side: side.name, node: child, key: `T:${tableKey(child)}` });
        break;
      case 'sdt':
        units.push({
          kind: 'sdt',
          side: side.name,
          node: child,
          key: `S:${side.keyOf(side.raw(child))}`,
        });
        break;
      case 'sectPr':
        break;
      default:
        units.push({
          kind: 'opaque',
          side: side.name,
          node: child,
          key: `O:${side.keyOf(side.raw(child))}`,
        });
    }
  }
  return units;
}

/** Plain text of a table, row by row, for alignment keys. */
export function tableKey(node: OoxmlNode): string {
  const rows: string[] = [];
  for (const row of elementChildren(node).filter((child) => child.localName === 'tr')) {
    rows.push(rowKey(row));
  }
  return rows.join('\u001E');
}

export function rowKey(row: OoxmlNode): string {
  return elementChildren(row)
    .filter((child) => child.localName === 'tc')
    .map((cell) => plainText(cell))
    .join('\u001F');
}

function plainText(node: OoxmlNode): string {
  if (!isElement(node)) return node.value;
  if (node.localName === 'p') return `${node.children.map(plainText).join('')}¶`;
  if (node.localName === 'instrText') return '';
  return node.children.map(plainText).join('');
}

interface WalkState {
  readonly atoms: Atom[];
  pending: string[];
}

export function paragraphUnit(node: ElementNode, side: SideContext): ParagraphUnit {
  const pPrNode = childNamed(node, 'pPr');
  const pPr: string[] = [];
  let markRPr = '';
  let sectPr: ElementNode | null = null;
  for (const child of pPrNode ? elementChildren(pPrNode) : []) {
    if (child.localName === 'rPr') markRPr = innerOf(side.serialize(withoutRevisionMarks(child)));
    else if (child.localName === 'sectPr') sectPr = child;
    else if (child.localName !== 'pPrChange') pPr.push(side.serialize(child));
  }
  const state: WalkState = { atoms: [], pending: [] };
  for (const child of node.children) {
    if (isElement(child) && child.localName !== 'pPr') walkInline(child, side, [], state);
  }
  const key = state.atoms
    .map((atom) => (atom.kind === 'char' ? atom.text : `\u0001${atom.key}\u0001`))
    .join('');
  return {
    kind: 'paragraph',
    side: side.name,
    node,
    pPr,
    markRPr,
    sectPr,
    atoms: state.atoms,
    trailingMarkers: state.pending,
    key: `P:${key}`,
  };
}

const REVISION_MARKS = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);

function withoutRevisionMarks(rPr: ElementNode): ElementNode {
  return {
    ...rPr,
    children: rPr.children.filter(
      (child) => !(isElement(child) && REVISION_MARKS.has(child.localName))
    ),
  } as ElementNode;
}

function walkInline(
  node: ElementNode,
  side: SideContext,
  wrappers: readonly Wrapper[],
  state: WalkState
): void {
  const name = node.localName;
  if (DROPPED.has(name)) return;
  if (MARKERS.has(name)) {
    // Bookmarks and permissions survive from the original only. Comments come from both
    // documents; the revised document's ids become placeholders, numbered on assembly.
    if (side.name === 'base') state.pending.push(side.serialize(node));
    else if (name === 'commentRangeStart' || name === 'commentRangeEnd')
      state.pending.push(revisedCommentMarker(side.serialize(node)));
    return;
  }
  if (name === 'r') {
    runAtoms(node, side, wrappers, state);
    return;
  }
  if (name === 'ins' || name === 'moveTo') {
    // Inputs are pre-accepted; a remaining wrapper is unwrapped.
    for (const child of elementChildren(node)) walkInline(child, side, wrappers, state);
    return;
  }
  if (name === 'del' || name === 'moveFrom') return;
  if (WRAPPERS.has(name)) {
    const wrapper = wrapperOf(node, side);
    const content = name === 'sdt' ? childNamed(node, 'sdtContent') : node;
    for (const child of content ? elementChildren(content) : []) {
      if (name === 'sdt' && (child.localName === 'sdtPr' || child.localName === 'sdtEndPr'))
        continue;
      walkInline(child, side, [...wrappers, wrapper], state);
    }
    return;
  }
  // Anything else inline (math, unknown extensions) is one object atom with no run properties.
  pushObject(node, '', side, wrappers, state);
}

function wrapperOf(node: ElementNode, side: SideContext): Wrapper {
  const name = node.localName;
  // Shell: the element with its content children removed.
  const keep =
    name === 'sdt'
      ? elementChildren(node).filter(
          (child) => child.localName === 'sdtPr' || child.localName === 'sdtEndPr'
        )
      : [];
  const content = name === 'sdt' ? childNamed(node, 'sdtContent') : undefined;
  const shellNode = {
    ...node,
    children: [...keep, ...(content ? [{ ...content, children: [] }] : [])],
  } as ElementNode;
  const xml = side.raw(shellNode);
  let start: string;
  let end: string;
  if (name === 'sdt') {
    const at = xml.lastIndexOf('<w:sdtContent');
    const shell = shellOf(xml.slice(at, xml.indexOf('>', at) + 1));
    start = xml.slice(0, at) + shell.start;
    end = `${shell.end}</w:sdt>`;
  } else {
    ({ start, end } = shellOf(xml));
  }
  const rid = attributeOf(node, 'id', R_NS);
  const key = `${name}|${rid ? side.relKey(rid) : ''}|${side.keyOf(start)}`;
  return { key, start: side.remap(start), end };
}

function runAtoms(
  run: ElementNode,
  side: SideContext,
  wrappers: readonly Wrapper[],
  state: WalkState
): void {
  const rPrNode = childNamed(run, 'rPr');
  const rPr = rPrNode ? innerOf(side.serialize(withoutRevisionMarks(rPrNode))) : '';
  for (const child of elementChildren(run)) {
    switch (child.localName) {
      case 'rPr':
        break;
      case 't':
      case 'delText': {
        const text = child.children
          .map((item) => (item.kind === 'textValue' ? item.value : ''))
          .join('');
        for (let i = 0; i < text.length; i++) {
          state.atoms.push({
            kind: 'char',
            text: text[i]!,
            xml: '',
            delXml: '',
            key: '',
            rPr,
            wrappers,
            markers: takePending(state),
          });
        }
        break;
      }
      case 'commentReference': {
        // A comment's reference run is a range marker, not compared content.
        const reference = `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${side.serialize(child)}</w:r>`;
        state.pending.push(side.name === 'base' ? reference : revisedCommentMarker(reference));
        break;
      }
      default:
        if (!DROPPED.has(child.localName)) pushObject(child, rPr, side, wrappers, state);
    }
  }
}

function pushObject(
  node: ElementNode,
  rPr: string,
  side: SideContext,
  wrappers: readonly Wrapper[],
  state: WalkState
): void {
  const raw = side.raw(node);
  const xml = side.remap(raw);
  const delXml = xml
    .replace(/^<w:instrText\b/, '<w:delInstrText')
    .replace(/<\/w:instrText>$/, '</w:delInstrText>');
  const boxes = textBoxesOf(node).length > 0;
  const noteKind =
    node.localName === 'footnoteReference'
      ? 'footnote'
      : node.localName === 'endnoteReference'
        ? 'endnote'
        : undefined;
  const noteId = noteKind ? attributeOf(node, 'id') : undefined;
  state.atoms.push({
    kind: 'object',
    text: OBJECT_TEXT,
    xml,
    delXml,
    // Note references align by position; their notes compare as stories of their own.
    key: noteKind
      ? `noteRef:${noteKind}`
      : boxes
        ? side.keyOf(side.raw(withBoxMarkers(node)))
        : side.keyOf(raw),
    rPr,
    wrappers,
    markers: takePending(state),
    ...(noteKind && noteId !== undefined ? { note: { kind: noteKind, id: noteId } } : {}),
    ...(boxes ? { node } : {}),
  });
}

/** A revised-document comment marker, with its comment id as an assembly placeholder. */
function revisedCommentMarker(xml: string): string {
  return xml.replace(/\bw:id="([^"]*)"/, (_, id: string) => `w:id="${commentPlaceholder(id)}"`);
}

function takePending(state: WalkState): readonly string[] {
  if (state.pending.length === 0) return [];
  const markers = state.pending;
  state.pending = [];
  return markers;
}
