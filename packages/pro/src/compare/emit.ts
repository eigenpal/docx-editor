/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Serializes compare output: runs, revision wrappers, and paragraph properties.
 */
import type { Atom, ParagraphUnit, SideContext, Wrapper } from './units.ts';
import {
  elementChildren,
  escapeAttribute,
  escapeText,
  innerOf,
  type ElementNode,
} from './xml-fragments.ts';

export type Mark = 'eq' | 'ins' | 'del' | 'moveFrom' | 'moveTo';

export interface Item {
  readonly mark: Mark;
  readonly atom: Atom;
  /** Run properties of the matching original atom (equal items only). */
  readonly baseRPr: string;
  readonly markers: readonly string[];
}

export type NoteKind = 'footnote' | 'endnote';

/** State shared by every story of one compare: revision ids and note bookkeeping. */
export class CompareState {
  nextId = 1;
  count = 0;
  /** Blocks the engine could not track (kept or dropped without a revision). */
  untracked = 0;
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
export const notePlaceholder = (kind: NoteKind, revisedId: string) => `§NOTE:${kind}:${revisedId}§`;

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
  attrs(): string {
    this.state.count++;
    const date = this.date === undefined ? '' : ` w:date="${this.date}"`;
    return ` w:id="${this.state.nextId++}" w:author="${escapeAttribute(this.author)}"${date}`;
  }
}

const sameWrappers = (a: readonly Wrapper[], b: readonly Wrapper[]) =>
  a.length === b.length && a.every((wrapper, i) => wrapper.key === b[i]!.key);

/** Paragraph content (everything after `w:pPr`) for a list of items. */
export function emitContent(items: readonly Item[], ctx: EmitContext): string {
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
    const formatChange =
      first.mark === 'eq' && ctx.detectFormatChanges && first.baseRPr !== first.atom.rPr;
    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (next.markers.length > 0 || next.mark !== first.mark || next.atom.rPr !== first.atom.rPr)
        break;
      // Field characters, drawings, and other objects each take a run of their own.
      if (next.atom.kind === 'object' || first.atom.kind === 'object') break;
      if (!sameWrappers(next.atom.wrappers, first.atom.wrappers)) break;
      const nextChange =
        next.mark === 'eq' && ctx.detectFormatChanges && next.baseRPr !== next.atom.rPr;
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

/** `w:sectPr` children without header and footer references, serialized. */
function sectPrBody(node: ElementNode, side: SideContext): string {
  return elementChildren(node)
    .filter((child) => !isRef(child) && child.localName !== 'sectPrChange')
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
  extraRefs = ''
): string {
  const source = revised ?? base;
  if (!source) return '';
  const side = revised ? ctx.revised : ctx.base;
  const refs =
    (base
      ? elementChildren(base)
          .filter(isRef)
          .map((child) => ctx.base.serialize(child))
          .join('')
      : '') + extraRefs;
  const body = sectPrBody(source, side);
  let change = '';
  if (base && revised && ctx.detectFormatChanges) {
    const before = sectPrBody(base, ctx.base);
    if (normalizeSect(before) !== normalizeSect(body))
      change = `<w:sectPrChange${ctx.attrs()}><w:sectPr>${before}</w:sectPr></w:sectPrChange>`;
  }
  const shell = side.raw({ ...source, children: [] } as ElementNode);
  const start = shell.replace(/\/>$/, '>');
  return `${start}${refs}${body}${change}</w:sectPr>`;
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
