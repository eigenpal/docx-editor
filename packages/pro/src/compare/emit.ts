/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Serializes compare output: runs, revision wrappers, and paragraph properties.
 */
import { pushAll } from './arrays.ts';
import { sectionRecord } from './section-record.ts';
import {
  controlIdentity,
  isControlWrapper,
  MARK,
  OBJECT_TEXT,
  placeholderValue,
  type Atom,
  type ParagraphUnit,
  type SideContext,
  type Wrapper,
} from './units.ts';
import {
  attributeOf,
  elementChildren,
  escapeAttribute,
  escapeText,
  innerOf,
  R_NS,
  type ElementNode,
} from './xml-fragments.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export type Mark = 'eq' | 'ins' | 'del' | 'moveFrom' | 'moveTo';

export interface Item {
  readonly mark: Mark;
  readonly atom: Atom;
  /** Run properties of the matching original atom (equal items only). */
  readonly baseRPr: string;
  readonly markers: readonly string[];
}

export type NoteKind = 'footnote' | 'endnote';

/** A header or footer reference the output adds to a section break. */
export interface SectionReference {
  readonly kind: 'header' | 'footer';
  /** One of `default`, `first`, or `even`. */
  readonly type: string;
  /** The output relationship id. */
  readonly id: string;
}

/** State shared by every story of one compare: revision ids and note bookkeeping. */
export class CompareState {
  nextId = 1;
  count = 0;
  /** Blocks the engine could not track (kept or dropped without a revision). */
  untracked = 0;
  /** Output relationship ids for the revised main story's header and footer references. */
  readonly furnitureIds = new Map<string, string>();
  /**
   * Header and footer references to add to the original's earlier section breaks, by section
   * index: slots only the revised document shows there.
   */
  sectionReferences: ReadonlyMap<number, readonly SectionReference[]> = new Map();
  /**
   * The section index of each original section break, in the order the section resolver
   * counts them (breaks inside block controls included), set before any story is written.
   */
  readonly baseSectionIndex = new WeakMap<object, number>();
  /** Section or table settings the revised document adds that a record cannot restore. */
  unrecordedProperties = 0;
  /** Move ranges written so far; names each range pair. */
  moves = 0;
  /** Note references matched between the documents: compare the two notes. */
  readonly notePairs: { kind: NoteKind; base: string; revised: string }[] = [];
  /** Note references only in the revised document: add the note as inserted content. */
  readonly newNotes: { kind: NoteKind; revised: string }[] = [];
  /** Note references only in the original: its note content is deleted. */
  readonly deletedNotes: { kind: NoteKind; base: string }[] = [];
}

/** Placeholder for the id of a note added from the revised document. */
export const notePlaceholder = (kind: NoteKind, revisedId: string) =>
  `${MARK}NOTE:${kind}:${placeholderValue(revisedId)}§`;

/** Every note placeholder: the kind and the encoded revised id. */
export const NOTE_PLACEHOLDER = new RegExp(`${MARK}NOTE:(footnote|endnote):([^§"]+)§`, 'g');

export class EmitContext {
  constructor(
    readonly state: CompareState,
    readonly author: string,
    readonly date: string | undefined,
    readonly detectFormatChanges: boolean,
    readonly base: SideContext,
    readonly revised: SideContext
  ) {}

  /** The same compare, for another pair of stories. */
  withSides(base: SideContext, revised: SideContext): EmitContext {
    return new EmitContext(
      this.state,
      this.author,
      this.date,
      this.detectFormatChanges,
      base,
      revised
    );
  }

  get revisionCount(): number {
    return this.state.count;
  }

  /** Attributes of a move range marker: an id, the author and date, and the move's name. */
  rangeAttrs(name: string): { id: number; attrs: string } {
    const id = this.state.nextId++;
    const date = this.date === undefined ? '' : ` w:date="${this.date}"`;
    return {
      id,
      attrs: ` w:id="${id}" w:author="${escapeAttribute(this.author)}"${date} w:name="${name}"`,
    };
  }

  /** The `w:id w:author w:date` attribute triple of one new revision. */
  /** Revision attributes of a record whose schema type declares only an id (`w:tblGridChange`). */
  idOnly(): string {
    this.state.count++;
    return ` w:id="${this.state.nextId++}"`;
  }

  attrs(): string {
    this.state.count++;
    const date = this.date === undefined ? '' : ` w:date="${this.date}"`;
    return ` w:id="${this.state.nextId++}" w:author="${escapeAttribute(this.author)}"${date}`;
  }
}

const sameWrappers = (a: readonly Wrapper[], b: readonly Wrapper[]) =>
  a.length === b.length && a.every((wrapper, i) => wrapper.key === b[i]!.key);

/**
 * Items with each hyperlink or simple field whose whole content carries one revision mark
 * rewritten as a complex field inside that revision. Its own element would sit outside the
 * revision and stay, empty, after the revision is rejected (an insertion) or accepted (a
 * deletion); a field's characters go with its content.
 */
function withFieldForms(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    const depth = item.atom.wrappers.findIndex((wrapper) => wrapper.field !== undefined);
    if (depth < 0 || item.mark === 'eq') {
      out.push(item);
      i++;
      continue;
    }
    const wrapper = item.atom.wrappers[depth]!;
    let j = i + 1;
    while (j < items.length && items[j]!.atom.wrappers[depth] === wrapper) j++;
    // Equal content of a link keeps the revised side's wrapper, so the original's wrapper
    // around deleted items can look whole while part of the link stays: count its atoms.
    const whole =
      (i === 0 || items[i - 1]!.atom.wrappers[depth] !== wrapper) &&
      j - i === wrapper.atomCount &&
      items.slice(i, j).every((other) => other.mark === item.mark);
    if (!whole) {
      pushAll(out, items.slice(i, j));
      i = j;
      continue;
    }
    const outer = item.atom.wrappers.slice(0, depth);
    const synthetic = (xml: string, delXml: string, markers: readonly string[] = []): Item => ({
      mark: item.mark,
      baseRPr: '',
      markers,
      atom: {
        kind: 'object',
        text: OBJECT_TEXT,
        xml,
        delXml,
        key: '',
        rPr: '',
        wrappers: outer,
        markers,
      },
    });
    const fldChar = (type: string) => {
      const xml = `<w:fldChar w:fldCharType="${type}"/>`;
      return synthetic(xml, xml);
    };
    const instr = escapeText(wrapper.field!);
    const inner = items.slice(i, j).map((other, k) => ({
      ...other,
      markers: k === 0 ? [] : other.markers,
      atom: {
        ...other.atom,
        wrappers: [...outer, ...other.atom.wrappers.slice(depth + 1)],
      },
    }));
    // One item per character: the list goes in without a spread, which a long link overflows.
    pushAll(
      out,
      [
        { ...fldChar('begin'), markers: item.markers },
        synthetic(
          `<w:instrText xml:space="preserve">${instr}</w:instrText>`,
          `<w:delInstrText xml:space="preserve">${instr}</w:delInstrText>`
        ),
        fldChar('separate'),
      ],
      withFieldForms(inner),
      [fldChar('end')]
    );
    i = j;
  }
  return out;
}

const FROM_ORIGINAL: ReadonlySet<Mark> = new Set(['del', 'moveFrom']);

/**
 * Deleted content and the revised content next to it in the same control (the same content
 * control id, say, of a field the revised document fills in) share one control: the revised
 * one, whose properties the result takes. Otherwise the original's shell would stay as a
 * second control with the same id, empty after accept. Only neighbors merge, so two unrelated
 * controls that happen to repeat an id stay apart.
 */
function unifyControls(items: readonly Item[]): readonly Item[] {
  const alias = new Map<Wrapper, Wrapper>();
  const resolve = (wrapper: Wrapper) => alias.get(wrapper) ?? wrapper;
  for (let i = 1; i < items.length; i++) {
    const left = items[i - 1]!;
    const right = items[i]!;
    const leftOriginal = FROM_ORIGINAL.has(left.mark);
    if (leftOriginal === FROM_ORIGINAL.has(right.mark)) continue;
    const [original, revised] = leftOriginal ? [left, right] : [right, left];
    const depth = Math.min(original.atom.wrappers.length, revised.atom.wrappers.length);
    for (let d = 0; d < depth; d++) {
      const from = resolve(original.atom.wrappers[d]!);
      const to = resolve(revised.atom.wrappers[d]!);
      if (from === to || from.key === to.key) continue;
      if (!isControlWrapper(from.key) || controlIdentity(from.key) !== controlIdentity(to.key))
        break;
      alias.set(from, to);
    }
  }
  if (alias.size === 0) return items;
  return items.map((item) =>
    item.atom.wrappers.some((wrapper) => alias.has(wrapper))
      ? { ...item, atom: { ...item.atom, wrappers: item.atom.wrappers.map(resolve) } }
      : item
  );
}

/** Paragraph content (everything after `w:pPr`) for a list of items. */
export function emitContent(source: readonly Item[], ctx: EmitContext): string {
  const unified = unifyControls(source);
  const items = unified.some((item) => item.mark !== 'eq') ? withFieldForms(unified) : unified;
  let out = '';
  const open: Wrapper[] = [];
  let openMark: Mark = 'eq';
  const closeMark = () => {
    if (openMark !== 'eq') out += `</w:${openMark}>`;
    openMark = 'eq';
  };
  const syncWrappers = (target: readonly Wrapper[]) => {
    let common = 0;
    while (
      common < open.length &&
      common < target.length &&
      open[common]!.key === target[common]!.key
    )
      common++;
    if (common === open.length && common === target.length) return;
    closeMark();
    while (open.length > common) out += open.pop()!.end;
    for (let i = common; i < target.length; i++) {
      open.push(target[i]!);
      out += target[i]!.start;
    }
  };
  let i = 0;
  while (i < items.length) {
    const first = items[i]!;
    const formatChange = recordsFormat(first, ctx);
    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (next.markers.length > 0 || next.mark !== first.mark || next.atom.rPr !== first.atom.rPr)
        break;
      // Field characters, drawings, and other objects each take a run of their own.
      if (next.atom.kind === 'object' || first.atom.kind === 'object') break;
      if (!sameWrappers(next.atom.wrappers, first.atom.wrappers)) break;
      const nextChange = recordsFormat(next, ctx);
      if (nextChange !== formatChange || (formatChange && next.baseRPr !== first.baseRPr)) break;
      j++;
    }
    syncWrappers(first.atom.wrappers);
    if (first.markers.length > 0) {
      closeMark();
      out += first.markers.join('');
    }
    if (first.mark !== openMark) {
      closeMark();
      if (first.mark !== 'eq') out += `<w:${first.mark}${ctx.attrs()}>`;
      openMark = first.mark;
    }
    if (first.atom.outsideRun) {
      // The revision wrapper may hold it directly; a run may not.
      out += first.atom.xml;
      i = j;
      continue;
    }
    out += runXml(
      items.slice(i, j),
      formatChange ? first.baseRPr : null,
      first.mark === 'del',
      ctx
    );
    i = j;
  }
  closeMark();
  while (open.length > 0) out += open.pop()!.end;
  return out;
}

/** Whether an item's run records its original formatting: equal or moved text that changed. */
const recordsFormat = (item: Item, ctx: EmitContext) =>
  (item.mark === 'eq' || item.mark === 'moveFrom' || item.mark === 'moveTo') &&
  ctx.detectFormatChanges &&
  item.baseRPr !== item.atom.rPr;

function runXml(
  items: readonly Item[],
  baseRPr: string | null,
  deleted: boolean,
  ctx: EmitContext
): string {
  let rPr = items[0]!.atom.rPr;
  if (baseRPr !== null) rPr += `<w:rPrChange${ctx.attrs()}><w:rPr>${baseRPr}</w:rPr></w:rPrChange>`;
  let content = '';
  let text = '';
  const flush = () => {
    if (text === '') return;
    const tag = deleted ? 'w:delText' : 'w:t';
    content += `<${tag} xml:space="preserve">${escapeText(text)}</${tag}>`;
    text = '';
  };
  for (const { atom } of items) {
    if (atom.kind === 'char') text += atom.text;
    else {
      flush();
      content += deleted ? atom.delXml : atom.xml;
    }
  }
  flush();
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${content}</w:r>`;
}

// ---------------------------------------------------------------- paragraphs

const isRef = (node: ElementNode) =>
  node.localName === 'headerReference' || node.localName === 'footerReference';

/** `w:sectPr` children without header and footer references. */
const sectPrFields = (node: ElementNode | null) =>
  node
    ? elementChildren(node).filter((child) => !isRef(child) && child.localName !== 'sectPrChange')
    : [];

/** `w:sectPr` children without header and footer references, serialized. */
function sectPrBody(node: ElementNode, side: SideContext): string {
  return sectPrFields(node)
    .map((child) => side.serialize(child))
    .join('');
}

/**
 * Section properties for the output: the revised settings, the original's header and footer
 * references (the output keeps the original's header and footer parts), and a
 * `w:sectPrChange` when the settings differ.
 */
export function sectPrXml(
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext,
  /** References to header and footer parts the output adds. */
  extraRefs = '',
  /**
   * The body's final section, which every document has: a side without a `w:sectPr` uses the
   * default settings, so the difference is recorded like any other. A section break, by
   * contrast, travels with its paragraph mark and is passed one-sided on purpose.
   */
  finalSection = false
): string {
  const source = revised ?? base;
  if (!source) return '';
  const side = revised ? ctx.revised : ctx.base;
  const refs =
    (base
      ? elementChildren(base)
          .filter(isRef)
          .map((child) => ctx.base.serialize(child))
          .join('') + (finalSection ? '' : addedBaseSectionRefs(base, ctx))
      : revised && !finalSection
        ? addedSectionRefs(revised, ctx)
        : '') + extraRefs;
  // The final section of a revised document without one takes the default settings.
  const body = revised || !finalSection ? sectPrBody(source, side) : '';
  let change = '';
  if (ctx.detectFormatChanges && (finalSection || (base && revised))) {
    const before = base ? sectPrBody(base, ctx.base) : '';
    if (normalizeSect(before) !== normalizeSect(body)) {
      // A reject keeps every setting the record leaves out, so the record names them all.
      const record = sectionRecord(sectPrFields(base), body ? sectPrFields(source) : [], ctx.base);
      if (record === null) ctx.state.unrecordedProperties++;
      change = `<w:sectPrChange${ctx.attrs()}><w:sectPr>${record ?? before}</w:sectPr></w:sectPrChange>`;
    }
  }
  const shell = side.raw({ ...source, children: [] } as ElementNode);
  const start = shell.replace(/\/>$/, '>');
  return `${start}${refs}${body}${change}</w:sectPr>`;
}

/**
 * Header and footer references of a section break only the revised document has: each points
 * at the output part that holds the revised content, so the section shows it after accept.
 */
function addedSectionRefs(revised: ElementNode, ctx: EmitContext): string {
  let out = '';
  for (const child of elementChildren(revised).filter(isRef)) {
    const type = attributeOf(child, 'type', W_NS) ?? 'default';
    const id = ctx.state.furnitureIds.get(attributeOf(child, 'id', R_NS) ?? '');
    if (id === undefined || !/^(default|first|even)$/.test(type)) {
      ctx.state.unrecordedProperties++;
      continue;
    }
    out += `<w:${child.localName} xmlns:r="${R_NS}" w:type="${type}" r:id="${escapeAttribute(id)}"/>`;
  }
  return out;
}

/**
 * References the output adds to an original section break other than the final one: header
 * and footer slots only the revised document shows in that section.
 */
function addedBaseSectionRefs(base: ElementNode, ctx: EmitContext): string {
  const state = ctx.state;
  const index = state.baseSectionIndex.get(base);
  // A break the resolver does not count shows nothing of its own: nothing to add.
  if (index === undefined) return '';
  let out = '';
  for (const { kind, type, id } of state.sectionReferences.get(index) ?? [])
    out += `<w:${kind}Reference xmlns:r="${R_NS}" w:type="${type}" r:id="${escapeAttribute(id)}"/>`;
  return out;
}

/** Revision-session ids are not settings. */
const normalizeSect = (xml: string) => xml.replace(/\sw:rsid\w*="[^"]*"/g, '');

/** The `w:pPr` of an output paragraph whose mark is equal, inserted, or deleted. */
export function paragraphProperties(
  mark: Mark,
  base: ParagraphUnit | null,
  revised: ParagraphUnit | null,
  ctx: EmitContext
): string {
  const own = mark === 'del' || mark === 'moveFrom' ? base! : revised!;
  let rPr = own.markRPr;
  if (mark !== 'eq') rPr = `<w:${mark}${ctx.attrs()}/>${rPr}`;
  else if (base && ctx.detectFormatChanges && base.markRPr !== own.markRPr) {
    rPr += `<w:rPrChange${ctx.attrs()}><w:rPr>${base.markRPr}</w:rPr></w:rPrChange>`;
  }
  let sect = '';
  if (mark === 'eq') sect = sectPrXml(base?.sectPr ?? null, own.sectPr, ctx);
  else if (own.sectPr && (mark === 'ins' || mark === 'del'))
    sect = sectPrXml(mark === 'del' ? own.sectPr : null, mark === 'del' ? null : own.sectPr, ctx);
  let change = '';
  if (mark === 'eq' && base && ctx.detectFormatChanges && base.pPr.join('') !== own.pPr.join('')) {
    change = `<w:pPrChange${ctx.attrs()}><w:pPr>${base.pPr.join('')}</w:pPr></w:pPrChange>`;
  }
  const inner = `${own.pPr.join('')}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${sect}${change}`;
  return inner ? `<w:pPr>${inner}</w:pPr>` : '';
}

export function paragraphXml(pPr: string, content: string): string {
  return `<w:p>${pPr}${content}</w:p>`;
}

/** Inner XML of a serialized properties element, or '' when absent. */
export function propertiesInner(
  node: ElementNode | undefined,
  side: SideContext,
  drop: ReadonlySet<string>
): string {
  if (!node) return '';
  const kept = {
    ...node,
    children: node.children.filter(
      (child) => !(child.kind !== 'textValue' && drop.has(child.localName))
    ),
  } as ElementNode;
  return innerOf(side.serialize(kept));
}
