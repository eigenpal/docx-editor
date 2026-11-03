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
import {
  relationshipsOf,
  resolveInternalTarget,
  serializeOoxmlPart,
  sha256Bytes,
} from '@docx-editor.dev/core/store';
import { textBoxesOf, withBoxMarkers } from './text-boxes.ts';
import { numberingMapOf, withMappedNumbering } from './definitions.ts';
import {
  attributeOf,
  childNamed,
  elementChildren,
  innerOf,
  isElement,
  withInheritedBindings,
  shellOf,
  R_NS,
  unescapeXml,
  type ElementNode,
  type NamespaceScope,
} from './xml-fragments.ts';

export type SideName = 'base' | 'revised';

export interface Wrapper {
  /** Identity used in token keys; includes resolved link targets. */
  readonly key: string;
  readonly start: string;
  readonly end: string;
  /**
   * The field instruction that expresses this wrapper (a hyperlink or a simple field), so a
   * wrapper whose whole content is inserted or deleted can be written as a field inside the
   * revision. A shell left outside the revision would stay, empty, after accept or reject.
   */
  readonly field?: string;
  /**
   * How many atoms this wrapper holds in its paragraph, set once its content is read. Only a
   * run of items that covers all of them is the whole wrapper.
   */
  atomCount?: number;
}

/** A complex field (`w:fldChar` begin to end) that atoms sit in; `instr` grows as it is read. */
export interface FieldContext {
  instr: string;
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
  /** A paragraph-level element (math, unknown extensions): written outside any run. */
  readonly outsideRun?: true;
  /** The complex fields this atom sits in, outermost first (field characters included). */
  readonly fields?: readonly FieldContext[];
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

/**
 * Start of every marker the engine writes into output XML and replaces on assembly. The random
 * nonce keeps text or attribute values a document holds from matching a marker: a document that
 * contains marker-like text must keep it unchanged.
 */
export const MARK = `§${[...globalThis.crypto.getRandomValues(new Uint32Array(4))]
  .map((word) => word.toString(16).padStart(8, '0'))
  .join('')}`;

/** Id placeholder of a comment taken from the revised document. */
export const commentPlaceholder = (id: string) => `${MARK}CMT:${placeholderValue(id)}§`;

/**
 * A file-supplied value (an id or a part name) inside a placeholder, encoded so that it holds
 * neither the terminator `§` nor the separators `|` and `"`. `fromPlaceholder` reverses it.
 */
export const placeholderValue = (value: string) => encodeURIComponent(value);
export const fromPlaceholder = (value: string) => decodeURIComponent(value);

/**
 * Candidate relationship-valued attributes. The serializer chooses its own prefixes, so the
 * prefix is checked against the relationships namespace before the value counts as an id.
 */
const REL_ATTRIBUTE =
  /(\b([A-Za-z_][\w.-]*):(id|embed|link|pict|href|dm|lo|qs|cs|relid)=")([^"]+)"/g;

/** VML image data names its relationship with `o:relid`, in the Office VML namespace. */
const O_NS = 'urn:schemas-microsoft-com:office:office';
/**
 * Revised-side relationship ids are written as `<MARK>REL:<revised owner part>|<id>§` and resolved
 * on assembly against the output part that holds the fragment.
 */
export const REL_PLACEHOLDER = `${MARK}REL:`;

/**
 * A drawing's document-wide id (`wp:docPr/@id`) from the revised document, written as
 * `<MARK>DOCPR:<id>§` and numbered on assembly, so that it never repeats an id the original
 * uses. A repeated id is renumbered when the file opens, and a rejected drawing then differs
 * from the original's.
 */
export const DRAWING_ID_PLACEHOLDER = `${MARK}DOCPR:`;
const DRAWING_ID = /(<(?:[A-Za-z_][\w.-]*:)?docPr\b[^>]*?\sid=")([^"]*)"/g;
/** A floating drawing's z-order (`wp:anchor/@relativeHeight`), unique in a document the same way. */
export const Z_ORDER_PLACEHOLDER = `${MARK}ZORDER:`;
const Z_ORDER = /(<(?:[A-Za-z_][\w.-]*:)?anchor\b[^>]*?\srelativeHeight=")([^"]*)"/g;

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

/** A wrapper's own properties child, which belongs to its shell, never to its content. */
const WRAPPER_PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  sdt: new Set(['sdtPr', 'sdtEndPr']),
  smartTag: new Set(['smartTagPr']),
  customXml: new Set(['customXmlPr']),
  fldSimple: new Set(['fldData']),
};

/**
 * Wrappers whose properties have no revision form and whose shell stays when their content is
 * rejected: equal text inside two different ones is recorded as moving between them.
 */
export const isControlWrapper = (key: string) =>
  key.startsWith('sdt|') || key.startsWith('smartTag|') || key.startsWith('customXml|');

/**
 * Which control a wrapper is: a content control by its id, which stays when the control is
 * filled in or its other properties change; any other control by all of its properties.
 */
export function controlIdentity(key: string): string {
  if (!key.startsWith('sdt|')) return key;
  const id = /<w:id w:val="([^"]*)"/.exec(key)?.[1];
  return id === undefined ? key : `sdt#${id}`;
}

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
      const target = partNameOf(this.partName, rel.target);
      const walk = { seen: new Set<string>(), visits: 0, local: false };
      key = `${rel.type}|${partIdentity(this.pkg, target, walk)}`;
      this.#mediaKeys.set(id, key);
    }
    return key;
  }

  /** The target of an external relationship, or undefined. */
  externalTarget(id: string): string | undefined {
    const rel = this.#rels.get(id);
    return rel?.external ? rel.target : undefined;
  }

  /** Serialized node, with relationship ids as written. */
  raw(node: OoxmlNode): string {
    const root = this.pkg.parts.get(this.partName)?.root;
    const xml = this.scope.serialize(
      withInheritedBindings(node, root && isElement(root) ? root.namespaceBindings : [])
    );
    // Revised lists take their output ids, so equal lists compare equal.
    const lists = this.name === 'revised' ? numberingMapOf(this.pkg) : undefined;
    return lists ? withMappedNumbering(xml, lists) : xml;
  }

  /** Serialized node; revised-side relationship ids become import placeholders. */
  serialize(node: OoxmlNode): string {
    return this.remap(this.raw(node));
  }

  remap(xml: string): string {
    if (this.name === 'base') return xml;
    const declared = localDeclarations(xml);
    return xml
      .replace(REL_ATTRIBUTE, (whole, lead: string, prefix: string, name: string, id: string) =>
        this.#isRelationshipPrefix(prefix, name, declared)
          ? `${lead}${REL_PLACEHOLDER}${placeholderValue(this.partName)}|${placeholderValue(unescapeXml(id))}§"`
          : whole
      )
      .replace(
        DRAWING_ID,
        (_, lead: string, id: string) =>
          `${lead}${DRAWING_ID_PLACEHOLDER}${placeholderValue(unescapeXml(id))}§"`
      )
      .replace(
        Z_ORDER,
        (_, lead: string, value: string) =>
          `${lead}${Z_ORDER_PLACEHOLDER}${placeholderValue(unescapeXml(value))}§"`
      );
  }

  /**
   * Key of a raw serialized fragment, with relationship ids resolved to their targets. Paragraph
   * identities and revision-save ids are left out: they say nothing about content, and an editor
   * adds paragraph identities to a document it opens.
   */
  keyOf(raw: string): string {
    const declared = localDeclarations(raw);
    return withoutIdentities(raw).replace(
      REL_ATTRIBUTE,
      (whole, lead: string, prefix: string, name: string, id: string) =>
        this.#isRelationshipPrefix(prefix, name, declared)
          ? `${lead}${this.relKey(unescapeXml(id))}"`
          : whole
    );
  }

  /** Whether `prefix` names the relationships namespace in the fragment or the root scope. */
  #isRelationshipPrefix(
    prefix: string,
    name: string,
    declared: ReadonlyMap<string, string>
  ): boolean {
    const uri = declared.get(prefix) ?? this.scope.uriOf(prefix);
    return uri === (name === 'relid' ? O_NS : R_NS);
  }
}

/** Paragraph identity and revision-save id attributes, in any prefix. */
const IDENTITY_ATTRIBUTE = /\s[\w.-]+:(?:paraId|textId|rsid\w*)="[^"]*"/g;
const PREFIX_DECLARATION = /\sxmlns:([\w.-]+)="[^"]*"/g;

/** `xml` without identity attributes, and without the declarations only they used. */
function withoutIdentities(xml: string): string {
  if (!IDENTITY_ATTRIBUTE.test(xml)) return xml;
  IDENTITY_ATTRIBUTE.lastIndex = 0;
  const stripped = xml.replace(IDENTITY_ATTRIBUTE, '');
  return stripped.replace(PREFIX_DECLARATION, (whole, prefix: string) =>
    stripped.includes(`${prefix}:`, stripped.indexOf(whole) + whole.length) ? whole : ''
  );
}

/**
 * Prefix declarations in a serialized fragment, the first declaration of each prefix. Read once
 * per fragment, so a fragment with many relationship attributes is scanned once.
 */
function localDeclarations(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml.includes('xmlns:')) return out;
  for (const match of xml.matchAll(/\sxmlns:([^\s=]+)="([^"]*)"/g))
    if (!out.has(match[1]!)) out.set(match[1]!, match[2]!);
  return out;
}

/**
 * The part an internal target names from `owner`, decoded as the package reader decodes it.
 * A target that is not a valid part name keeps a key of its own, which names no part.
 */
function partNameOf(owner: string, target: string): string {
  const resolved = resolveInternalTarget(owner, target);
  return resolved.ok ? resolved.partName : `invalid:${owner}|${target}`;
}

const identities = new WeakMap<OoxmlPackage, Map<string, string>>();
const encoder = new TextEncoder();
/** Parts one identity follows through relationships; a larger closure counts as different. */
const MAX_CLOSURE = 256;
/** Identities of closures past the bound, each one new. */
let overflows = 0;

/**
 * Content identity of a part: a SHA-256 digest of its bytes (or of its XML, for parts the
 * reader models) and of every part it reaches through its own relationships. Two images,
 * charts, or embedded objects compare as equal only when all of that is equal.
 */
interface IdentityWalk {
  readonly seen: Set<string>;
  /** Relationships followed so far, repeated ones included. */
  visits: number;
  /** Set when an identity depends on a cycle or the bound: it holds only for this walk. */
  local: boolean;
}

function partIdentity(pkg: OoxmlPackage, name: string, walk: IdentityWalk): string {
  let cache = identities.get(pkg);
  if (!cache) identities.set(pkg, (cache = new Map()));
  const known = cache.get(name);
  if (known !== undefined) return known;
  if (walk.seen.has(name)) {
    walk.local = true;
    return `cycle:${name}`;
  }
  // A closure past the bound was not read in full, so its identity is unique: it never matches
  // another, even one with the same names and shape. It is never cached (`local`).
  if (walk.seen.size >= MAX_CLOSURE || walk.visits >= MAX_CLOSURE) {
    walk.local = true;
    return `overflow:${++overflows}`;
  }
  walk.seen.add(name);
  const part = pkg.parts.get(name);
  const bytes =
    pkg.partBytes.get(name) ??
    pkg.partBytes.get(name.slice(1)) ??
    (part ? encoder.encode(serializeOoxmlPart(part)) : undefined);
  let identity = bytes ? sha256Bytes(bytes) : `missing:${name}`;
  const wasLocal = walk.local;
  walk.local = false;
  for (const rel of relationshipsOf(pkg, name)) {
    walk.visits++;
    const target =
      rel.targetMode === 'External'
        ? `external:${rel.rawTarget}`
        : partIdentity(pkg, partNameOf(name, rel.rawTarget), walk);
    identity += `|${rel.id}:${rel.type}:${target}`;
  }
  walk.seen.delete(name);
  // Each identity is one fixed-size digest, however many parts it reaches.
  identity = sha256Bytes(encoder.encode(identity));
  if (!walk.local) cache.set(name, identity);
  walk.local ||= wasLocal;
  return identity;
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
      // A cell's properties are written by the table compare, never copied as content.
      case 'tcPr':
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
  /** Open complex fields of the paragraph, and a shared copy for the atoms inside them. */
  readonly fieldStack: FieldContext[];
  fields: readonly FieldContext[] | undefined;
}

const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Opens and closes complex fields around `push`, which adds the field character's atom. */
function trackFieldChar(node: ElementNode, state: WalkState, push: () => void): void {
  const type = attributeOf(node, 'fldCharType', W_MAIN);
  if (type === 'begin') {
    state.fieldStack.push({ instr: '' });
    state.fields = [...state.fieldStack];
  }
  push();
  if (type === 'end' && state.fieldStack.length > 0) {
    state.fieldStack.pop();
    state.fields = state.fieldStack.length > 0 ? [...state.fieldStack] : undefined;
  }
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
  const state: WalkState = { atoms: [], pending: [], fieldStack: [], fields: undefined };
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
    const before = state.atoms.length;
    for (const child of content ? elementChildren(content) : []) {
      if (WRAPPER_PROPERTIES[name]?.has(child.localName)) continue;
      walkInline(child, side, [...wrappers, wrapper], state);
    }
    // An empty wrapper is still content (a simple field with no result shows its value): one
    // atom with nothing of its own keeps it in the output and lets it compare.
    if (state.atoms.length === before) {
      state.atoms.push({
        kind: 'object',
        text: OBJECT_TEXT,
        xml: '',
        delXml: '',
        key: 'empty',
        rPr: '',
        wrappers: [...wrappers, wrapper],
        markers: takePending(state),
        ...(state.fields ? { fields: state.fields } : {}),
      });
    }
    wrapper.atomCount = state.atoms.length - before;
    return;
  }
  // Anything else inline (math, unknown extensions) is one object atom with no run properties,
  // a child of the paragraph rather than of a run.
  pushObject(node, '', side, wrappers, state, true);
}

function wrapperOf(node: ElementNode, side: SideContext): Wrapper {
  const name = node.localName;
  // Shell: the element with its content children removed.
  const properties = WRAPPER_PROPERTIES[name];
  const keep = properties
    ? elementChildren(node).filter((child) => properties.has(child.localName))
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
    // The properties child stays in the shell, first, as the schema orders it.
    ({ start, end } = shellOf(xml));
    if (keep.length > 0) start += innerOf(xml);
  }
  const rid = attributeOf(node, 'id', R_NS);
  const key = `${name}|${rid ? side.relKey(rid) : ''}|${side.keyOf(start)}`;
  const field = fieldInstruction(node, side, rid);
  return { key, start: side.remap(start), end, ...(field === undefined ? {} : { field }) };
}

/** A field argument in quotes; undefined when the value cannot be quoted. */
const quoted = (value: string) => (/["\\]/.test(value) ? undefined : `"${value}"`);

/**
 * The field instruction equal to a hyperlink or a simple field: `HYPERLINK "target" \l "anchor"`,
 * or the simple field's own instruction. Undefined when there is none (an internal link target,
 * a field with field data), and then the wrapper keeps its own form.
 */
function fieldInstruction(
  node: ElementNode,
  side: SideContext,
  rid: string | undefined
): string | undefined {
  if (node.localName === 'fldSimple') {
    if (childNamed(node, 'fldData')) return undefined;
    const instr = attributeOf(node, 'instr', W_MAIN);
    return instr && instr.trim() !== '' ? instr : undefined;
  }
  if (node.localName !== 'hyperlink') return undefined;
  const parts = ['HYPERLINK'];
  if (rid) {
    const target = side.externalTarget(rid);
    const value = target === undefined ? undefined : quoted(target);
    if (value === undefined) return undefined;
    parts.push(value);
  }
  for (const [attribute, switchName] of [
    ['anchor', 'l'],
    ['tooltip', 'o'],
    ['tgtFrame', 't'],
  ] as const) {
    const raw = attributeOf(node, attribute, W_MAIN);
    if (raw === undefined) continue;
    const value = quoted(raw);
    if (value === undefined) return undefined;
    parts.push(`\\${switchName} ${value}`);
  }
  if (parts.length === 1) return undefined;
  // A field link without `\h` reads back as a link with history; one with it, without.
  const history = attributeOf(node, 'history', W_MAIN);
  if (history !== '1' && history !== 'true' && history !== 'on') parts.push('\\h');
  return ` ${parts.join(' ')} `;
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
            ...(state.fields ? { fields: state.fields } : {}),
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
      case 'fldChar':
        trackFieldChar(child, state, () => pushObject(child, rPr, side, wrappers, state));
        break;
      case 'instrText': {
        const top = state.fieldStack[state.fieldStack.length - 1];
        if (top)
          top.instr += child.children
            .map((item) => (item.kind === 'textValue' ? item.value : ''))
            .join('');
        pushObject(child, rPr, side, wrappers, state);
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
  state: WalkState,
  outsideRun = false
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
    // Note references align by position; their notes compare as stories of their own. Every
    // attribute but the id (a custom mark) takes part, so a changed one is recorded.
    key: noteKind
      ? `noteRef:${noteKind}:${node.attributes
          .filter((attribute) => attribute.localName !== 'id')
          .map(
            (attribute) =>
              `${attribute.namespaceUri ?? ''}|${attribute.localName}=${attribute.value}`
          )
          .sort()
          .join(' ')}`
      : boxes
        ? side.keyOf(side.raw(withBoxMarkers(node)))
        : side.keyOf(raw),
    rPr,
    wrappers,
    markers: takePending(state),
    ...(noteKind && noteId !== undefined ? { note: { kind: noteKind, id: noteId } } : {}),
    ...(boxes ? { node } : {}),
    ...(outsideRun ? { outsideRun: true as const } : {}),
    ...(state.fields ? { fields: state.fields } : {}),
  });
}

/** A revised-document comment marker, with its comment id as an assembly placeholder. */
function revisedCommentMarker(xml: string): string {
  return xml.replace(
    /\bw:id="([^"]*)"/,
    (_, id: string) => `w:id="${commentPlaceholder(unescapeXml(id))}"`
  );
}

/** Shared by every atom with no markers: one array, not one per character. */
const NO_MARKERS: readonly string[] = Object.freeze([]);

function takePending(state: WalkState): readonly string[] {
  if (state.pending.length === 0) return NO_MARKERS;
  const markers = state.pending;
  state.pending = [];
  return markers;
}
