/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Reads any tracked-changes DOCX into a comparable normal form.
 *
 * The same reader runs on a reference redline and on the engine's output, so the two can be
 * compared without depending on run boundaries, ids, authors, dates, or attribute order.
 */
import { readOoxmlPackage, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';

export type SegmentMark = 'eq' | 'ins' | 'del' | 'moveFrom' | 'moveTo';

export interface NormalSegment {
  readonly text: string;
  readonly mark: SegmentMark;
  /** The run carries a `w:rPrChange`. */
  readonly formatChanged: boolean;
}

export interface NormalParagraph {
  readonly segments: readonly NormalSegment[];
  /** Revision on the paragraph mark (`w:pPr/w:rPr/w:ins|w:del`). */
  readonly mark: 'ins' | 'del' | null;
  readonly propertiesChanged: boolean;
  /** Revision on the enclosing table row (`w:trPr/w:ins|w:del`). */
  readonly row: 'ins' | 'del' | null;
  /** Nesting depth of tables around the paragraph. */
  readonly tableDepth: number;
  readonly inTextBox: boolean;
}

export interface NormalStory {
  /** `body`, `header`, `footer`, `footnotes`, `endnotes`, `comments`. */
  readonly kind: string;
  readonly part: string;
  readonly paragraphs: readonly NormalParagraph[];
}

export interface RedlineNormalForm {
  readonly stories: readonly NormalStory[];
  /** Counts of revision elements by local name (ins, del, rPrChange, sectPrChange, ...). */
  readonly revisionCounts: Readonly<Record<string, number>>;
  readonly authors: readonly string[];
}

/** Placeholder characters for non-text inline content. */
export const OBJECT_CHAR = '￼';
export const NOTE_REF_CHAR = '‡';

const REVISION_ELEMENTS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
  'cellMerge',
]);

interface Element {
  readonly localName: string;
  readonly children: readonly OoxmlNode[];
  readonly attributes: readonly { readonly localName?: string; readonly value?: string }[];
}

const isElement = (node: OoxmlNode): node is OoxmlNode & Element =>
  'localName' in node && 'children' in node;

const childrenOf = (node: OoxmlNode): readonly OoxmlNode[] =>
  isElement(node) ? node.children : [];

const child = (node: OoxmlNode, name: string): (OoxmlNode & Element) | undefined =>
  childrenOf(node).find(
    (item): item is OoxmlNode & Element => isElement(item) && item.localName === name
  );

function storyKind(part: OoxmlPart): string | null {
  const type = part.contentType;
  if (type.endsWith('document.main+xml')) return 'body';
  if (type.endsWith('.header+xml')) return 'header';
  if (type.endsWith('.footer+xml')) return 'footer';
  if (type.endsWith('.footnotes+xml')) return 'footnotes';
  if (type.endsWith('.endnotes+xml')) return 'endnotes';
  if (type.endsWith('.comments+xml')) return 'comments';
  return null;
}

const STORY_ORDER = ['body', 'header', 'footer', 'footnotes', 'endnotes', 'comments'];

export function redlineNormalForm(bytes: Uint8Array): RedlineNormalForm {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(`unreadable package: ${read.reason}`);
  const counts: Record<string, number> = {};
  const authors = new Set<string>();
  const stories: NormalStory[] = [];
  const parts = [...read.package.parts.values()]
    .map((part) => ({ part, kind: storyKind(part) }))
    .filter((item): item is { part: OoxmlPart; kind: string } => item.kind !== null)
    .sort(
      (a, b) =>
        STORY_ORDER.indexOf(a.kind) - STORY_ORDER.indexOf(b.kind) ||
        a.part.name.localeCompare(b.part.name)
    );
  for (const { part, kind } of parts) {
    const paragraphs: NormalParagraph[] = [];
    countRevisions(part.root, counts, authors);
    collectParagraphs(part.root, paragraphs, {
      row: null,
      tableDepth: 0,
      inTextBox: false,
      skipNote: kind === 'footnotes' || kind === 'endnotes',
    });
    stories.push({ kind, part: part.name, paragraphs });
  }
  return { stories, revisionCounts: counts, authors: [...authors].sort() };
}

function countRevisions(
  node: OoxmlNode,
  counts: Record<string, number>,
  authors: Set<string>
): void {
  if (!isElement(node)) return;
  if (REVISION_ELEMENTS.has(node.localName)) {
    counts[node.localName] = (counts[node.localName] ?? 0) + 1;
    const author = node.attributes.find((attribute) => attribute.localName === 'author')?.value;
    if (author) authors.add(author);
  }
  for (const item of node.children) countRevisions(item, counts, authors);
}

interface Scope {
  readonly row: 'ins' | 'del' | null;
  readonly tableDepth: number;
  readonly inTextBox: boolean;
  readonly skipNote: boolean;
}

function collectParagraphs(node: OoxmlNode, out: NormalParagraph[], scope: Scope): void {
  if (!isElement(node)) return;
  if (node.localName === 'footnote' || node.localName === 'endnote') {
    // Separator notes carry no content.
    const type = node.attributes.find((attribute) => attribute.localName === 'type')?.value;
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice')
      return;
  }
  if (node.localName === 'p') {
    out.push(paragraphOf(node, scope));
    // Text boxes nested inside this paragraph's runs become their own paragraphs, after it.
    for (const item of node.children) collectNested(item, out, scope);
    return;
  }
  let next = scope;
  if (node.localName === 'tbl') next = { ...scope, tableDepth: scope.tableDepth + 1 };
  if (node.localName === 'tr') {
    const trPr = child(node, 'trPr');
    next = {
      ...next,
      row: trPr && child(trPr, 'ins') ? 'ins' : trPr && child(trPr, 'del') ? 'del' : null,
    };
  }
  for (const item of node.children) collectParagraphs(item, out, next);
}

function collectNested(node: OoxmlNode, out: NormalParagraph[], scope: Scope): void {
  if (!isElement(node)) return;
  if (node.localName === 'txbxContent') {
    for (const item of node.children) collectParagraphs(item, out, { ...scope, inTextBox: true });
    return;
  }
  for (const item of node.children) collectNested(item, out, scope);
}

function paragraphOf(paragraph: OoxmlNode & Element, scope: Scope): NormalParagraph {
  const segments: NormalSegment[] = [];
  const pPr = child(paragraph, 'pPr');
  const markRPr = pPr ? child(pPr, 'rPr') : undefined;
  // A moved paragraph's mark goes with its text: away from the source, in at the destination.
  const has = (name: string) => !!markRPr && !!child(markRPr, name);
  const mark = has('ins') || has('moveTo') ? 'ins' : has('del') || has('moveFrom') ? 'del' : null;
  const push = (text: string, segmentMark: SegmentMark, formatChanged: boolean) => {
    if (text === '') return;
    const last = segments[segments.length - 1];
    if (last && last.mark === segmentMark && last.formatChanged === formatChanged) {
      segments[segments.length - 1] = { ...last, text: last.text + text };
    } else {
      segments.push({ text, mark: segmentMark, formatChanged });
    }
  };
  const walk = (node: OoxmlNode, segmentMark: SegmentMark, inField: { code: boolean }) => {
    if (!isElement(node)) return;
    switch (node.localName) {
      case 'pPr':
      case 'txbxContent':
        return;
      case 'ins':
      case 'del':
      case 'moveFrom':
      case 'moveTo':
        for (const item of node.children) walk(item, node.localName, inField);
        return;
      case 'r': {
        const rPr = child(node, 'rPr');
        const formatChanged = rPr !== undefined && child(rPr, 'rPrChange') !== undefined;
        for (const item of node.children) {
          if (!isElement(item)) continue;
          switch (item.localName) {
            case 't':
            case 'delText':
              if (!inField.code) push(textOf(item), segmentMark, formatChanged);
              break;
            case 'tab':
            case 'ptab':
              push('\t', segmentMark, formatChanged);
              break;
            case 'br':
            case 'cr':
              push('\n', segmentMark, formatChanged);
              break;
            case 'noBreakHyphen':
              push('-', segmentMark, formatChanged);
              break;
            case 'sym':
              push(OBJECT_CHAR, segmentMark, formatChanged);
              break;
            case 'drawing':
            case 'pict':
            case 'object':
              push(OBJECT_CHAR, segmentMark, formatChanged);
              break;
            case 'footnoteReference':
            case 'endnoteReference':
              push(NOTE_REF_CHAR, segmentMark, formatChanged);
              break;
            case 'fldChar': {
              const type = item.attributes.find(
                (attribute) => attribute.localName === 'fldCharType'
              )?.value;
              if (type === 'begin') inField.code = true;
              else if (type === 'separate' || type === 'end') inField.code = false;
              break;
            }
            default:
              break;
          }
        }
        return;
      }
      default:
        for (const item of node.children) walk(item, segmentMark, inField);
    }
  };
  const field = { code: false };
  for (const item of paragraph.children) walk(item, 'eq', field);
  return {
    segments,
    mark,
    propertiesChanged: pPr !== undefined && child(pPr, 'pPrChange') !== undefined,
    row: scope.row,
    tableDepth: scope.tableDepth,
    inTextBox: scope.inTextBox,
  };
}

function textOf(node: OoxmlNode): string {
  let text = '';
  for (const item of childrenOf(node)) {
    if ('value' in item && typeof item.value === 'string') text += item.value;
  }
  return text;
}
