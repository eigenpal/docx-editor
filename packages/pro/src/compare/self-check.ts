/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Proves a compare result with the engine's own review operations: accepting every revision
 * must give the revised document, and rejecting every revision must give the original.
 *
 * Text is the hard requirement. Paragraph properties are checked too, but a difference there
 * is reported rather than fatal: some structure has no revision form (a content control added
 * around existing text, a section break added or removed), and refusing the whole compare for
 * it would be worse than showing every text change.
 *
 * Only these stories are checked: the main story, the notes, and the headers and footers of the
 * final section. Earlier sections' headers and footers compare with the same engine.
 */
import {
  applyTreeOp,
  digestPart,
  readOoxmlPart,
  resolveHeaderFooterResolutionBySection,
  serializeOoxmlPart,
  sha256Bytes,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type ParagraphDigest,
} from '@docx-editor.dev/core/store';
import { pushAll } from './arrays.ts';
import { comparedStoryParts } from './stories.ts';
import { attributeOf, elementChildren, isElement, type ElementNode } from './xml-fragments.ts';

/** The compared story parts of `pkg`, the main story first. */
const storyParts = comparedStoryParts;

type Level = 'text' | 'properties';

const NOTE_REFERENCES: Readonly<Record<string, 'footnote' | 'endnote'>> = {
  footnoteReference: 'footnote',
  endnoteReference: 'endnote',
};

/**
 * Note ids, as `footnote:3`, that the main story references, each with the position of its
 * first reference. A notes part may list notes in any order; readers show them by reference.
 */
function referencedNotes(parts: readonly OoxmlPart[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const main = parts[0];
  const stack: ElementNode[] = main ? [main.root as ElementNode] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kind = NOTE_REFERENCES[node.localName];
    if (kind) {
      const key = `${kind}:${attributeOf(node, 'id') ?? ''}`;
      if (!out.has(key)) out.set(key, out.size);
      continue;
    }
    // Children are pushed last first, so they are visited in document order.
    const children = elementChildren(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return out;
}

/**
 * A notes part with only the notes something references, in reference order, after its
 * separators: notes nothing references never show.
 */
function referencedOnly(part: OoxmlPart, referenced: ReadonlyMap<string, number>): OoxmlPart {
  const kind = part.root.localName === 'footnotes' ? 'footnote' : 'endnote';
  const keyOf = (note: ElementNode) => `${kind}:${attributeOf(note, 'id') ?? ''}`;
  const all = elementChildren(part.root);
  const others = all.filter((note) => note.localName !== kind);
  const notes = all
    .filter((note) => note.localName === kind && referenced.has(keyOf(note)))
    .sort((a, b) => referenced.get(keyOf(a))! - referenced.get(keyOf(b))!);
  const children = [...others, ...notes];
  return { ...part, root: { ...part.root, children } as OoxmlPart['root'] };
}

const isNotesPart = (part: OoxmlPart) =>
  part.root.localName === 'footnotes' || part.root.localName === 'endnotes';

/** Paragraph text (and, at the properties level, paragraph properties) per story, sorted. */
const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * One field instruction, in a form that a hyperlink element and its field share: the link
 * target is a relationship on one and text on the other, so only the anchor takes part.
 */
function normalInstruction(instr: string): string {
  const text = instr.replace(/\s+/g, ' ').trim();
  if (!/^HYPERLINK\b/i.test(text)) return text;
  const anchor = /\\l\s+"([^"]*)"/.exec(text);
  return anchor ? `HYPERLINK \\l ${anchor[1]}` : 'HYPERLINK';
}

/**
 * The part without field codes, and its field instructions in document order. Field codes are
 * not text a reader sees; a hyperlink or simple field and the same field written with field
 * characters compare as equal, and any instruction difference still shows.
 */
const fieldFree = new WeakMap<OoxmlPart, { part: OoxmlPart; fields: string }>();

function withoutFieldCodes(part: OoxmlPart): { part: OoxmlPart; fields: string } {
  let known = fieldFree.get(part);
  if (!known) fieldFree.set(part, (known = fieldCodesRemoved(part)));
  return known;
}

/** Text under `node`, from its `w:t` elements. */
function textOf(node: ElementNode): string {
  let out = '';
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.localName === 't')
      out += child.children.map((item) => (isElement(item) ? '' : item.value)).join('');
    else out += textOf(child);
  }
  return out;
}

/** A content control that shows its placeholder and holds nothing but white space. */
function emptyPlaceholder(control: ElementNode): boolean {
  const properties = elementChildren(control).find((child) => child.localName === 'sdtPr');
  if (!properties || !elementChildren(properties).some((c) => c.localName === 'showingPlcHdr'))
    return false;
  const content = elementChildren(control).find((child) => child.localName === 'sdtContent');
  return !content || textOf(content).trim() === '';
}

function fieldCodesRemoved(part: OoxmlPart): { part: OoxmlPart; fields: string } {
  const fields: string[] = [];
  const open: { instr: string; index: number }[] = [];
  let untyped = false;
  const walk = (node: ElementNode, paragraph: ElementNode | null, control = false): ElementNode => {
    const name = node.localName;
    const inParagraph = name === 'p' ? node : paragraph;
    // A content control's content is digested from its typed tree: change it by a re-read.
    const inControl = control || name === 'sdt';
    if (name === 'hyperlink') {
      const anchor = attributeOf(node, 'anchor', W_MAIN);
      fields.push(anchor === undefined ? 'HYPERLINK' : `HYPERLINK \\l ${anchor}`);
    } else if (name === 'fldChar') {
      const type = attributeOf(node, 'fldCharType', W_MAIN);
      if (type === 'begin') {
        open.push({ instr: '', index: fields.length });
        fields.push('');
      } else if (type === 'end') {
        const field = open.pop();
        if (field) fields[field.index] = normalInstruction(field.instr);
      }
    }
    let changed = false;
    const children: OoxmlNode[] = [];
    for (const child of node.children) {
      if (!isElement(child)) {
        children.push(child);
        continue;
      }
      if (child.localName === 'sdt' && emptyPlaceholder(child)) {
        // A control emptied by a decision shows placeholder spaces, as an emptied control
        // does in any editor; it carries no text of either document.
        changed = true;
        untyped = true;
        continue;
      }
      if (child.localName === 'instrText' || child.localName === 'delInstrText') {
        const top = open[open.length - 1];
        if (top)
          top.instr += child.children.map((item) => (isElement(item) ? '' : item.value)).join('');
        changed = true;
        continue;
      }
      if (child.localName === 'fldSimple') {
        // A simple field shows its result like a field with field characters does.
        fields.push(normalInstruction(attributeOf(child, 'instr', W_MAIN) ?? ''));
        const inner = elementChildren(child)
          .filter((item) => item.localName !== 'fldData')
          .map((item) => walk(item, inParagraph, inControl));
        // Content under a simple field is read untyped; type it, so its runs show their text.
        const typed = inParagraph && !inControl ? typedContent(part, inParagraph, inner) : null;
        if (typed) pushAll(children, typed);
        else {
          pushAll(children, inner);
          untyped = true;
        }
        changed = true;
        continue;
      }
      const next = walk(child, inParagraph, inControl);
      if (next !== child) changed = true;
      children.push(next);
    }
    return changed ? ({ ...node, children } as ElementNode) : node;
  };
  if (!isElement(part.root)) return { part, fields: '' };
  const root = walk(part.root, null);
  if (root === part.root) return { part, fields: oneEntryPerLink(fields) };
  const changed = { ...part, root } as OoxmlPart;
  if (!untyped) return { part: changed, fields: oneEntryPerLink(fields) };
  // Re-read, so the typed tree the digest reads holds the changed content.
  const reread = readOoxmlPart(serializeOoxmlPart(changed), {
    name: part.name,
    contentType: part.contentType,
  });
  return { part: reread.ok ? reread.part : changed, fields: oneEntryPerLink(fields) };
}

/**
 * Inline content as the reader types it inside a paragraph: `content` is serialized in a copy
 * of `paragraph` (which keeps its namespace scope) within the part's root, and read back.
 */
function typedContent(
  part: OoxmlPart,
  paragraph: ElementNode,
  content: readonly ElementNode[]
): readonly OoxmlNode[] | null {
  if (!isElement(part.root)) return null;
  const p = { ...paragraph, children: content } as ElementNode;
  const body = elementChildren(part.root).find((child) => child.localName === 'body');
  const holder = body ? [{ ...body, children: [p] } as ElementNode] : [p];
  const fragment = readOoxmlPart(
    serializeOoxmlPart({ ...part, root: { ...part.root, children: holder } } as OoxmlPart),
    { name: part.name, contentType: part.contentType }
  );
  if (!fragment.ok || !isElement(fragment.part.root)) return null;
  const top = elementChildren(fragment.part.root)[0];
  const read = top?.localName === 'body' ? elementChildren(top)[0] : top;
  return read?.localName === 'p' ? read.children.filter((child) => isElement(child)) : null;
}

/**
 * A link split in pieces around a revision (or around a field inside it) is still one link:
 * a piece repeats the previous link entry when no other link comes between them.
 */
function oneEntryPerLink(fields: readonly string[]): string {
  let lastLink = '';
  const out: string[] = [];
  for (const field of fields) {
    if (field.startsWith('HYPERLINK')) {
      if (field === lastLink) continue;
      lastLink = field;
    }
    out.push(field);
  }
  return out.join('|');
}

function fingerprint(list: readonly OoxmlPart[], level: Level): string {
  const stories: string[] = [];
  const referenced = referencedNotes(list);
  for (const story of list) {
    const { part, fields } = withoutFieldCodes(
      isNotesPart(story) ? referencedOnly(story, referenced) : story
    );
    const digest = digestPart(part);
    if (!digest) continue;
    // Empty paragraphs carry no text. A note whose reference was rejected (or accepted away)
    // stays as an empty note, and a deleted block content control keeps an empty paragraph
    // when no paragraph follows it to join.
    const notes = isNotesPart(part);
    const paragraphs = digest.paragraphs
      .filter((paragraph) => (level === 'properties' && !notes) || paragraph.text.trim() !== '')
      .map((paragraph) => paragraphFingerprint(paragraph, level));
    // Empty stories carry no content (a deleted header, a notes part with only separators).
    if (digest.paragraphs.every((paragraph) => paragraph.text.trim() === '')) continue;
    stories.push(`${paragraphs.join('\n')}${fields ? `\n\u0002${fields}` : ''}`);
  }
  return stories.sort().join('\n\n');
}

function paragraphFingerprint(paragraph: ParagraphDigest, level: Level): string {
  if (level === 'text') {
    // An emptied content control shows placeholder spaces; whitespace runs are not compared.
    return paragraph.text.replace(/\s+/g, ' ').trim();
  }
  // An empty paragraph-mark `w:rPr` (left when a mark revision resolves) carries nothing.
  const properties = paragraph.paragraphProperties.filter((property) => property !== 'rPr');
  return `${paragraph.text}\u0001${properties.join('|')}`;
}

/** Every revision element a decision resolves; `numberingChange` is dropped by every decision. */
export const REVISION_NAMES: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
  'cellMerge',
]);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Whether `node` holds a revision element. Drawing path commands such as `a:moveTo` are not. */
export function hasRevision(node: OoxmlPart['root'] | ElementNode): boolean {
  if (!isElement(node)) return false;
  if (node.namespaceUri === W_NS && REVISION_NAMES.has(node.localName)) return true;
  return node.children.some((child) => isElement(child) && hasRevision(child));
}

/** Reasons a review decision refuses that come from the content, not from the compare. */
const GUARDS = new Set(['locked', 'bound']);
/** A decision refused for another reason, or one that left a revision behind. */
const UNDECIDED = 'undecided';

function resolved(
  pkg: OoxmlPackage,
  op: 'acceptAllRevisions' | 'rejectAllRevisions',
  guards: Set<string>
): OoxmlPart[] {
  const out: OoxmlPart[] = [];
  for (const part of storyParts(pkg)) {
    if (!hasRevision(part.root)) {
      out.push(part);
      continue;
    }
    out.push(decide(part, op, guards));
  }
  return out;
}

/**
 * `part` with every revision decided by `op`, re-read so renamed elements (a restored
 * `w:instrText`) take their typed kinds. Every revision the compare wrote must resolve: a
 * refused decision, or one that leaves a revision behind, means a reviewer cannot reach that
 * document. The guard names a refusal the content causes; any other one is `undecided`.
 */
function decide(
  part: OoxmlPart,
  op: 'acceptAllRevisions' | 'rejectAllRevisions',
  guards: Set<string>
): OoxmlPart {
  const result = applyTreeOp(part, { op });
  if (!result.ok) guards.add(GUARDS.has(result.reason) ? result.reason : UNDECIDED);
  else if (hasRevision(result.part.root)) guards.add(UNDECIDED);
  const next = result.ok ? result.part : part;
  const reread = readOoxmlPart(serializeOoxmlPart(next), {
    name: next.name,
    contentType: next.contentType,
  });
  return reread.ok ? reread.part : next;
}

/**
 * What every section shows in its header and footer slots, as `kind:type=text` per section.
 * With `op`, the main story and every header and footer part are resolved first.
 */
const furnitureEncoder = new TextEncoder();

function sectionFurniture(
  pkg: OoxmlPackage,
  op?: 'acceptAllRevisions' | 'rejectAllRevisions',
  /** The main story already resolved with `op`. */
  main?: OoxmlPart,
  guards: Set<string> = new Set()
): string {
  let view = pkg;
  if (op) {
    const parts = new Map(pkg.parts);
    if (main?.name !== pkg.mainDocumentPart) main = undefined;
    if (main) parts.set(pkg.mainDocumentPart, main);
    const names = new Set<string>();
    for (const section of resolveHeaderFooterResolutionBySection(pkg))
      for (const slots of [section.headers, section.footers])
        for (const slot of slots.values()) names.add(slot.part.name);
    if (!main) names.add(pkg.mainDocumentPart);
    for (const name of names) {
      const part = parts.get(name);
      if (!part || !hasRevision(part.root)) continue;
      // Parts only earlier sections show are decided here, so their refusals count too.
      parts.set(name, decide(part, op, guards));
    }
    view = { ...pkg, parts };
  }
  // Sections share parts: each part's text is read and hashed once, and a section names it by
  // the hash, so a long header in many sections is not copied into every section's entry.
  const texts = new Map<OoxmlPart, string>();
  const textOf = (part: OoxmlPart) => {
    let text = texts.get(part);
    if (text === undefined) {
      const full = fingerprint([part], 'text');
      text = full === '' ? '' : sha256Bytes(furnitureEncoder.encode(full));
      texts.set(part, text);
    }
    return text;
  };
  return resolveHeaderFooterResolutionBySection(view)
    .map((section) => {
      const entries: string[] = [];
      for (const [kind, slots] of [
        ['header', section.headers],
        ['footer', section.footers],
      ] as const)
        for (const [type, slot] of slots) {
          // An empty header or footer shows the same as none.
          const text = textOf(slot.part);
          if (text !== '') entries.push(`${kind}:${type}=${text}`);
        }
      return entries.sort().join('|');
    })
    .join('\n');
}

export interface SelfCheckResult {
  /** Accepting every revision gives the revised document's text. */
  readonly accept: boolean;
  /** Rejecting every revision gives the original's text. */
  readonly reject: boolean;
  /** Paragraph properties also agree in both directions. */
  readonly properties: boolean;
  /**
   * Why some revisions cannot be accepted or rejected, comma-separated: `locked` or `bound` for
   * a lock or a data binding on a content control, `undecided` for any other refusal or a
   * revision left behind. Any guard fails the check, whatever the text shows.
   */
  readonly guard?: string;
  readonly detail?: string;
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `${JSON.stringify(a.slice(Math.max(0, i - 40), i + 80))} vs ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 80))}`;
}

export function selfCheck(
  output: OoxmlPackage,
  original: OoxmlPackage,
  revised: OoxmlPackage
): SelfCheckResult {
  const guards = new Set<string>();
  const accepted = resolved(output, 'acceptAllRevisions', guards);
  const rejected = resolved(output, 'rejectAllRevisions', guards);
  const check = (level: Level) => {
    const a = fingerprint(accepted, level);
    const r = fingerprint(rejected, level);
    const expectedA = fingerprint(storyParts(revised), level);
    const expectedR = fingerprint(storyParts(original), level);
    return {
      accept: a === expectedA,
      reject: r === expectedR,
      detail:
        a !== expectedA
          ? `accept: ${firstDifference(a, expectedA)}`
          : r !== expectedR
            ? `reject: ${firstDifference(r, expectedR)}`
            : undefined,
    };
  };
  const furniture = (): ReturnType<typeof check> => {
    const accept =
      sectionFurniture(output, 'acceptAllRevisions', accepted[0], guards) ===
      sectionFurniture(revised);
    const reject =
      sectionFurniture(output, 'rejectAllRevisions', rejected[0], guards) ===
      sectionFurniture(original);
    const which = !accept ? 'accept' : !reject ? 'reject' : undefined;
    return {
      accept,
      reject,
      detail: which && `${which}: a section shows other headers or footers`,
    };
  };
  const stories = check('text');
  const text = stories.accept && stories.reject ? furniture() : stories;
  const properties = text.accept && text.reject ? check('properties') : text;
  const detail = text.detail ?? properties.detail;
  return {
    accept: text.accept,
    reject: text.reject,
    properties: properties.accept && properties.reject,
    ...(guards.size > 0 ? { guard: [...guards].sort().join(',') } : {}),
    ...(detail === undefined ? {} : { detail }),
  };
}
