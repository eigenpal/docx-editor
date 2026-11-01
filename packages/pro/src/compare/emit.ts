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

export type Mark = 'eq' | 'ins' | 'del';

export interface Item {
  readonly mark: Mark;
  readonly atom: Atom;
  /** Run properties of the matching original atom (equal items only). */
  readonly baseRPr: string;
  readonly markers: readonly string[];
}

export class EmitContext {
  #nextId = 1;
  #count = 0;
  /** Units or blocks the engine could not track (kept or dropped without a revision). */
  untracked = 0;

  constructor(
    readonly author: string,
    readonly date: string | undefined,
    readonly detectFormatChanges: boolean,
    readonly base: SideContext,
    readonly revised: SideContext
  ) {}

  get revisionCount(): number {
    return this.#count;
  }

  /** The `w:id w:author w:date` attribute triple of one new revision. */
  attrs(): string {
    this.#count++;
    const date = this.date === undefined ? '' : ` w:date="${this.date}"`;
    return ` w:id="${this.#nextId++}" w:author="${escapeAttribute(this.author)}"${date}`;
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
  ctx: EmitContext
): string {
  const source = revised ?? base;
  if (!source) return '';
  const side = revised ? ctx.revised : ctx.base;
  const refs = base
    ? elementChildren(base)
        .filter(isRef)
        .map((child) => ctx.base.serialize(child))
        .join('')
    : '';
  const body = sectPrBody(source, side);
  let change = '';
  if (base && revised && ctx.detectFormatChanges) {
    const before = sectPrBody(base, ctx.base);
    if (normalizeSect(before) !== normalizeSect(body))
      change = `<w:sectPrChange${ctx.attrs()}><w:sectPr>${before}</w:sectPr></w:sectPrChange>`;
  }
  const shell = side.scope.serialize({ ...source, children: [] } as ElementNode);
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
  const own = mark === 'del' ? base! : revised!;
  let rPr = own.markRPr;
  if (mark === 'ins' || mark === 'del') rPr = `<w:${mark}${ctx.attrs()}/>${rPr}`;
  else if (base && ctx.detectFormatChanges && base.markRPr !== own.markRPr) {
    rPr += `<w:rPrChange${ctx.attrs()}><w:rPr>${base.markRPr}</w:rPr></w:rPrChange>`;
  }
  let sect = '';
  if (mark === 'eq') sect = sectPrXml(base?.sectPr ?? null, own.sectPr, ctx);
  else if (own.sectPr)
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
