// Project attacker-controlled HTML into a bounded WordprocessingML fragment.
// HTML is size-capped before `DOMParser` creates an inert, detached document.
// The allowlist walker has fixed node and depth limits.
// It never attaches parsed nodes, executes markup, or fetches remote resources.
// Hyperlinks pass `sanitizeHref`, and images accept bounded `data:` URIs only.
// XML emission escapes all file-derived text and attributes.
import { sanitizeHref, escapeXmlAttribute } from '../store/package/sinks.ts';
import { projectHtmlImage } from './clipboard-html-images.ts';
import {
  htmlListKindAndStart,
  htmlListStartFromMarker,
  semanticHtmlListKind,
  semanticHtmlListStart,
  wordListDefinitionsFromStyleText,
  type HtmlListAllocation as ListAllocation,
  type HtmlListKind,
  type WordListLevelDefinition,
} from './clipboard-html-numbering.ts';
import { clipboardBookmarkName, isClipboardHyperlink } from './clipboard-html-links.ts';
import { clipboardLanguageTag } from './clipboard-html-language.ts';
import {
  writeProjectedHtmlPackage,
  type HtmlFragmentRel as RelEntry,
} from './clipboard-html-package.ts';
import {
  clipboardNoteDefinitions,
  clipboardNoteReference,
  isClipboardNoteList,
  type ClipboardNoteKind,
} from './clipboard-html-notes.ts';
import { paragraphXml, rPrXml, textRunXml } from './clipboard-html-run-xml.ts';
import {
  applyInlineTag,
  applyParaCss,
  applyRunCss,
  applyWordParagraphAlignment,
  isElement,
  isMsoListIgnoreMarker,
  isWordClipboardHtml,
  parseInlineStyle,
  tagOf,
  wordClassAlignmentsFromDocument,
  wordParagraphStyleId,
  wordStyleTextFromDocument,
  type HtmlParagraphAlign,
  type HtmlParaProps,
  type HtmlRunProps,
} from './clipboard-html-styles.ts';
import {
  cellCssPropertiesXml,
  htmlSpanOf,
  tableBordersXml,
  tableColumnWidths,
  tableJustification,
  tablePositionXml,
  tableRowsOf,
  tableRowPropertiesXml,
  tableSpanWidth,
  tableWidthTwips,
} from './clipboard-html-table-styles.ts';
import { htmlPositionalTabXml, htmlTabRunContents } from './clipboard-html-tabs.ts';
import {
  CONTAINER_TAGS,
  IGNORED_TAGS,
  PARAGRAPH_TAGS,
  hasBlockChild,
  isWordPageBreakBlock,
  isWordPageBreakSpacer,
  wordBlockSdtNodes,
} from './clipboard-html-word-structure.ts';

export interface HtmlProjectionLimits {
  /** UTF-8 size cap applied BEFORE parse. Default 4 MiB. */
  readonly maxHtmlBytes?: number;
  /** Walk cap: nodes visited past this stop contributing. Default 100,000. */
  readonly maxNodes?: number;
  /** Walk cap: children below this depth are not entered. Default 64. */
  readonly maxDepth?: number;
  /** Decoded per-image byte cap for `data:` URIs. Default 2 MiB. */
  readonly maxImageBytes?: number;
}

export type HtmlProjectionResult =
  | {
      readonly ok: true;
      /** A fragment package zip, readable by `readOoxmlPackage`. */
      readonly fragmentBytes: Uint8Array;
      /** True when the final projected paragraph carries a mapped Word style. */
      readonly lastMarkCovered: boolean;
      /** How many `data:` images the projection accepted into the fragment. */
      readonly imageCount: number;
    }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

const DEFAULT_MAX_HTML_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Heading direct formatting: bold plus these sizes in half-points (h1=32pt … h6=14pt). */
const HEADING_SZ: Record<string, number> = { h1: 64, h2: 52, h3: 44, h4: 36, h5: 32, h6: 28 };

type RunProps = HtmlRunProps;
type ParaProps = HtmlParaProps;

type ListState = { readonly numId: string; readonly level: number };

interface FlowContext {
  readonly run: RunProps;
  readonly para: ParaProps;
  readonly paragraphMarkCovered: boolean;
  readonly pre: boolean;
  readonly list: ListState | null;
  /** Set while projecting a note definition body: the note the blocks belong to. */
  readonly noteBody?: { readonly kind: ClipboardNoteKind; readonly id: number };
  readonly rels?: RelEntry[];
}

interface Projection {
  nodesLeft: number;
  readonly maxDepth: number;
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  lastMarkCovered: boolean;
  readonly rels: RelEntry[];
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
  readonly lists: Map<string, ListAllocation>;
  semanticListCount: number;
  imageCount: number;
  docPrId: number;
  nextBookmarkId: number;
  readonly classAlignments: ReadonlyMap<string, HtmlParagraphAlign>;
  /** Word's structured `@list lN:levelM` head rules, keyed `l<N>:level<M>`. */
  readonly listDefinitions: ReadonlyMap<string, WordListLevelDefinition>;
  readonly notes: Record<ClipboardNoteKind, Map<number, readonly string[]>>;
  readonly noteRels: Record<ClipboardNoteKind, RelEntry[]>;
  /** Ids with a PROJECTED definition — the only ids a live note reference may carry. */
  readonly definedNotes: Record<ClipboardNoteKind, ReadonlySet<number>>;
  /** The exact definition elements the notes pass consumed; only these skip the body
   *  walk, so a duplicate-id or unreferenced definition stays lossless in the body. */
  readonly definedNoteElements: ReadonlySet<Element>;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- Allocation

function allocateRel(
  p: Projection,
  type: string,
  target: string,
  external: boolean,
  rels = p.rels
): string {
  const id = `rId${rels.length + 1}`;
  rels.push({ id, type, target, external });
  return id;
}

function allocateList(
  p: Projection,
  key: string,
  kind: HtmlListKind,
  start = 1,
  level = 0
): string {
  const existing = p.lists.get(key);
  if (existing) {
    // First observation per level wins; other levels stay open for later markers.
    if (!existing.levels.has(level)) existing.levels.set(level, { kind, start });
    return existing.numId;
  }
  const numId = String(1001 + p.lists.size);
  p.lists.set(key, { numId, levels: new Map([[level, { kind, start }]]) });
  return numId;
}

// --- Walk

function collectInline(
  node: Node,
  depth: number,
  ctx: FlowContext,
  runs: string[],
  p: Projection
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const raw = node.nodeValue ?? '';
    if (ctx.pre) {
      const parts = raw.replace(/\r\n?/g, '\n').split('\n');
      parts.forEach((part, index) => {
        if (index > 0) runs.push(`<w:r>${rPrXml(ctx.run)}<w:br/></w:r>`);
        if (part.length > 0) runs.push(textRunXml(part, ctx.run));
      });
      return;
    }
    const collapsed = raw.replace(/\s+/g, ' ');
    if (collapsed.length === 0) return;
    if (collapsed === ' ' && runs.length === 0) return; // Whitespace between blocks.
    runs.push(textRunXml(collapsed, ctx.run));
    return;
  }
  if (!isElement(node)) return;
  const tag = tagOf(node);
  if (IGNORED_TAGS.has(tag)) return;
  const style = parseInlineStyle(node);
  if (isMsoListIgnoreMarker(style)) return; // Word's literal list marker never becomes text.
  const msoElement = style.get('mso-element')?.trim().toLowerCase();
  if (
    msoElement === 'comment-reference' ||
    style.get('mso-special-character')?.trim().toLowerCase() === 'comment' ||
    node.classList.contains('msocomanchor')
  ) {
    return;
  }
  // A note definition the notes pass consumed projects only there; landing it here
  // would duplicate the note text into the body. Unconsumed definitions descend
  // normally, so their text stays lossless.
  if (p.definedNoteElements.has(node)) return;
  if (tag === 'w:ptab') {
    const tab = htmlPositionalTabXml(node);
    if (tab.length > 0) runs.push(`<w:r>${rPrXml(ctx.run)}${tab}</w:r>`);
    return;
  }
  const tabContent = htmlTabRunContents(style.get('mso-tab-count'));
  if (tabContent.length > 0) {
    runs.push(`<w:r>${rPrXml(ctx.run)}${tabContent}</w:r>`);
    // Word's tab spans hold only spacer whitespace; an element with real content —
    // text OR element children like an image — keeps it after the tabs.
    if ((node.textContent ?? '').trim().length === 0 && node.children.length === 0) return;
  }
  if (tag === 'br') {
    const pageBreak =
      style.get('page-break-before')?.trim().toLowerCase() === 'always' ||
      style.get('break-before')?.trim().toLowerCase() === 'page';
    runs.push(`<w:r>${rPrXml(ctx.run)}${pageBreak ? '<w:br w:type="page"/>' : '<w:br/>'}</w:r>`);
    return;
  }
  if (tag === 'img') {
    projectHtmlImage(node, runs, p, (target) =>
      allocateRel(p, `${R_NS}/image`, target, false, ctx.rels ?? p.rels)
    );
    return;
  }
  let taggedRun = applyInlineTag(ctx.run, tag);
  const linkHref = tag === 'a' ? node.getAttribute('href') : null;
  const noteReference = tag === 'a' ? clipboardNoteReference(style) : null;
  if (noteReference === null && isClipboardHyperlink(linkHref)) {
    taggedRun = { ...taggedRun, color: '0563C1', underline: true };
  }
  // Never mutate the shared context run: helpers return `base` by identity when idle.
  let nextRun = applyRunCss(taggedRun, style);
  const language = clipboardLanguageTag(node.getAttribute('lang'));
  if (language !== null) nextRun = { ...nextRun, lang: language };
  if (node.getAttribute('dir')?.trim().toLowerCase() === 'rtl') nextRun = { ...nextRun, rtl: true };
  const nextCtx: FlowContext = {
    ...ctx,
    run: nextRun,
    pre: ctx.pre || tag === 'pre',
  };
  if (noteReference !== null) {
    if (
      ctx.noteBody !== undefined &&
      ctx.noteBody.kind === noteReference.kind &&
      ctx.noteBody.id === noteReference.id
    ) {
      // The note's own number mark, inside its own body.
      const localName = noteReference.kind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
      runs.push(`<w:r>${rPrXml(nextCtx.run)}<w:${localName}/></w:r>`);
      return;
    }
    if (ctx.noteBody === undefined && p.definedNotes[noteReference.kind].has(noteReference.id)) {
      const localName =
        noteReference.kind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
      runs.push(`<w:r>${rPrXml(nextCtx.run)}<w:${localName} w:id="${noteReference.id}"/></w:r>`);
      return;
    }
    // A dangling or cross-note reference keeps its visible text instead of a live mark.
  }
  if (tag === 'a') {
    const href = node.getAttribute('href');
    const bookmarkName = clipboardBookmarkName(
      node.getAttribute('name') || node.getAttribute('id')
    );
    const inner: string[] = [];
    for (const child of Array.from(node.childNodes)) {
      collectInline(child, depth + 1, nextCtx, inner, p);
    }
    const anchor = href?.startsWith('#') ? clipboardBookmarkName(href.slice(1)) : null;
    let content = inner.join('');
    if (anchor !== null) {
      content = `<w:hyperlink w:anchor="${escapeXmlAttribute(anchor)}">${content}</w:hyperlink>`;
    } else if (href !== null) {
      // A fragment name Word cannot store (hyphens, length) stays an external-rel
      // hyperlink rather than dropping the link; a bare '#' is a JS anchor and
      // never becomes a relationship.
      const sanitized = sanitizeHref(href);
      if (sanitized.ok && sanitized.href.length > 0 && sanitized.href !== '#') {
        const relId = allocateRel(p, `${R_NS}/hyperlink`, sanitized.href, true, ctx.rels ?? p.rels);
        content = `<w:hyperlink r:id="${relId}">${content}</w:hyperlink>`;
      }
    }
    if (bookmarkName !== null) {
      const id = String(p.nextBookmarkId++);
      content =
        `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlAttribute(bookmarkName)}"/>` +
        `${content}<w:bookmarkEnd w:id="${id}"/>`;
    }
    if (content.length > 0) runs.push(content);
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    collectInline(child, depth + 1, nextCtx, runs, p);
  }
}

/** Word desktop's `mso-list:l<N> level<M> lfo<K>` convention on `MsoListParagraph`. */
function msoListNumPr(
  element: Element,
  style: ReadonlyMap<string, string>,
  p: Projection
): ParaProps['numPr'] {
  const declaration = style.get('mso-list');
  if (declaration === undefined) return undefined;
  const match = /\bl(\d{1,4})\s+level(\d{1,2})\b/i.exec(declaration);
  if (!match) return undefined;
  const ilvl = clamp(Number.parseInt(match[2]!, 10) - 1, 0, 8);
  const marker = msoMarkerText(element, p);
  // The head's structured @list rule names the format; the visible marker then
  // names THIS slice's first ordinal under that format. Glyph sniffing alone is
  // only the fallback — it cannot tell 'i.' the roman 1 from 'i.' the 9th letter.
  const definition = p.listDefinitions.get(`l${match[1]}:level${match[2]}`);
  let kind: HtmlListKind;
  let start: number;
  if (definition !== undefined) {
    kind = definition.kind;
    start = htmlListStartFromMarker(marker, kind) ?? definition.start ?? 1;
  } else {
    ({ kind, start } = htmlListKindAndStart(marker));
  }
  const lfo = /\blfo(\d{1,4})\b/i.exec(declaration);
  const key = `mso:l${match[1]}${lfo ? `:lfo${lfo[1]}` : ''}`;
  return { numId: allocateList(p, key, kind, start, ilvl), ilvl };
}

/** The text of the `mso-list:Ignore` marker span, for number-vs-bullet detection. */
function msoMarkerText(element: Element, p: Projection): string {
  let found = '';
  const walk = (node: Node, depth: number): void => {
    if (found.length > 0 || depth > 8 || p.nodesLeft <= 0) return;
    if (!isElement(node)) return;
    if (isMsoListIgnoreMarker(parseInlineStyle(node))) {
      found = (node.textContent ?? '').slice(0, 16);
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child, depth + 1);
  };
  for (const child of Array.from(element.childNodes)) walk(child, 0);
  return found;
}

/** The styled flow context a paragraph-shaped element hands its children. */
function paragraphContextOf(
  element: Element,
  ctx: FlowContext,
  p: Projection,
  pageBreakBefore: boolean
): FlowContext {
  const tag = tagOf(element);
  const style = parseInlineStyle(element);
  const para: ParaProps = {};
  if (pageBreakBefore) para.pageBreakBefore = true;
  const styleId = wordParagraphStyleId(element, p.wordHtml);
  if (styleId !== undefined) para.styleId = styleId;
  if (ctx.para.numPr) para.numPr = ctx.para.numPr;
  if (ctx.para.jc) para.jc = ctx.para.jc;
  let run = { ...ctx.run };
  const heading = HEADING_SZ[tag];
  if (heading !== undefined && styleId === undefined) {
    run.bold = true;
    run.szHalfPoints = heading;
  }
  const pre = ctx.pre || tag === 'pre';
  if (tag === 'pre') run.font = 'Courier New';
  const mso = msoListNumPr(element, style, p);
  if (mso) para.numPr = mso;
  applyWordParagraphAlignment(para, element, p.classAlignments);
  applyParaCss(para, style);
  // The background lands on BOTH the paragraph (w:pPr/w:shd) and its runs: the
  // single-paragraph inline paste path keeps only run content, so a run-level fill
  // is what survives a mid-paragraph paste.
  run = applyRunCss(run, style);
  const language = clipboardLanguageTag(element.getAttribute('lang'));
  if (language !== null) run.lang = language;
  if (element.getAttribute('dir')?.trim().toLowerCase() === 'rtl') {
    run.rtl = true;
    para.bidi = true;
  }
  return {
    run,
    para,
    // Only mark-defining properties (style, numbering) justify replacing the host
    // paragraph's mark on paste; incidental CSS (margins, alignment) must not force
    // the structural path for a plain single-paragraph snippet.
    paragraphMarkCovered: para.styleId !== undefined || para.numPr !== undefined,
    pre,
    list: ctx.list,
    ...(ctx.noteBody ? { noteBody: ctx.noteBody } : {}),
    ...(ctx.rels ? { rels: ctx.rels } : {}),
  };
}

function projectParagraph(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  pageBreakBefore = false
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  const next = paragraphContextOf(element, ctx, p, pageBreakBefore);
  projectFlow(Array.from(element.childNodes), depth + 1, next, p, out, true, undefined, false);
}

function projectList(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  pageBreakBefore = false
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const kind = semanticHtmlListKind(element);
  // One numId per distinct top-level list; nested lists share their root's definition
  // and record their own format at their level.
  if (!ctx.list) p.semanticListCount += 1;
  const state: ListState = ctx.list
    ? { numId: ctx.list.numId, level: Math.min(ctx.list.level + 1, 8) }
    : {
        numId: allocateList(p, `sem:${p.semanticListCount}`, kind, semanticHtmlListStart(element)),
        level: 0,
      };
  if (ctx.list) {
    for (const allocation of p.lists.values()) {
      if (allocation.numId === state.numId && !allocation.levels.has(state.level)) {
        allocation.levels.set(state.level, { kind, start: semanticHtmlListStart(element) });
      }
    }
  }
  const itemCtx: FlowContext = {
    ...ctx,
    list: state,
    para: { numPr: { numId: state.numId, ilvl: state.level } },
  };
  let pendingPageBreak = pageBreakBefore;
  for (const child of Array.from(element.childNodes)) {
    if (!isElement(child)) continue;
    const childTag = tagOf(child);
    if (childTag === 'li') {
      projectParagraph(child, depth + 1, itemCtx, p, out, pendingPageBreak);
      pendingPageBreak = false;
    } else if (childTag === 'ol' || childTag === 'ul') {
      const beforeNested = out.length;
      projectList(child, depth + 1, { ...ctx, list: state }, p, out, pendingPageBreak);
      if (out.length > beforeNested) pendingPageBreak = false;
    }
  }
}

type PageBreakState = { pending: boolean; skipSpacer: boolean };

function appendPageBreak(out: string[]): void {
  const last = out[out.length - 1];
  if (last?.endsWith('</w:p>')) {
    out[out.length - 1] = `${last.slice(0, -6)}<w:r><w:br w:type="page"/></w:r></w:p>`;
    return;
  }
  out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
}

function projectFlow(
  nodes: readonly Node[],
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  forceEmit = false,
  pageBreakState?: PageBreakState,
  extractPageBreakBlocks = true
): void {
  if (depth > p.maxDepth) return;
  const before = out.length;
  const ownsPageBreakState = pageBreakState === undefined;
  let pending: string[] = [];
  const pageBreak = pageBreakState ?? { pending: false, skipSpacer: false };
  const flush = (): void => {
    if (pending.length > 0) {
      // Bare inline text consumes a pending Word page break like a block would,
      // so the break lands BEFORE the text, not appended after it.
      const para = pageBreak.pending ? { ...ctx.para, pageBreakBefore: true } : ctx.para;
      out.push(paragraphXml(para, pending));
      pageBreak.pending = false;
      pageBreak.skipSpacer = false;
      p.lastMarkCovered = ctx.paragraphMarkCovered;
    }
    pending = [];
  };
  for (const node of nodes) {
    if (p.nodesLeft <= 0) break;
    if (isElement(node)) {
      const tag = tagOf(node);
      const blockSdtNodes = tag === 'w:sdt' ? wordBlockSdtNodes(node) : null;
      if (extractPageBreakBlocks && isWordPageBreakBlock(node)) {
        flush();
        p.nodesLeft -= 1;
        pageBreak.pending = true;
        pageBreak.skipSpacer = true;
        continue;
      }
      if (IGNORED_TAGS.has(tag)) {
        p.nodesLeft -= 1;
        continue;
      }
      const elementStyle = parseInlineStyle(node);
      if (elementStyle.get('mso-element')?.trim().toLowerCase() === 'comment-list') {
        p.nodesLeft -= 1;
        continue;
      }
      // The note-list wrapper is transparent: collected definitions inside it are
      // skipped below (they re-emit through the notes pass), while definitions past
      // the collection caps project into the body — ugly but lossless.
      if (isClipboardNoteList(elementStyle)) {
        flush();
        p.nodesLeft -= 1;
        projectFlow(
          Array.from(node.childNodes),
          depth + 1,
          ctx,
          p,
          out,
          false,
          pageBreak,
          extractPageBreakBlocks
        );
        continue;
      }
      // A note definition the notes pass consumed projects only there; walking it
      // here would land the note text twice, once in the body.
      if (p.definedNoteElements.has(node)) {
        p.nodesLeft -= 1;
        continue;
      }
      if (PARAGRAPH_TAGS.has(tag)) {
        flush();
        p.nodesLeft -= 1;
        if (pageBreak.pending && pageBreak.skipSpacer && isWordPageBreakSpacer(node)) {
          pageBreak.skipSpacer = false;
          continue;
        }
        if (tag === 'div' && hasBlockChild(node)) {
          // Word's section wrapper (`WordSection1`): block flow continues through it,
          // so page-break extraction and the spacer state must survive the descent.
          // A break declared ON the wrapper carries to its first child paragraph.
          const wrapperCtx = paragraphContextOf(node, ctx, p, false);
          if (wrapperCtx.para.pageBreakBefore) pageBreak.pending = true;
          projectFlow(
            Array.from(node.childNodes),
            depth + 1,
            wrapperCtx,
            p,
            out,
            false,
            pageBreak,
            extractPageBreakBlocks
          );
          continue;
        }
        projectParagraph(node, depth, ctx, p, out, pageBreak.pending);
        pageBreak.pending = false;
        pageBreak.skipSpacer = false;
        continue;
      }
      if (tag === 'ol' || tag === 'ul') {
        flush();
        const beforeList = out.length;
        projectList(node, depth, ctx, p, out, pageBreak.pending);
        if (out.length > beforeList) {
          pageBreak.pending = false;
          pageBreak.skipSpacer = false;
        }
        continue;
      }
      if (tag === 'table') {
        flush();
        if (pageBreak.pending) appendPageBreak(out);
        projectTable(node, depth, ctx, p, out);
        pageBreak.pending = false;
        pageBreak.skipSpacer = false;
        continue;
      }
      if (CONTAINER_TAGS.has(tag) || blockSdtNodes !== null) {
        flush();
        p.nodesLeft -= 1;
        projectFlow(
          blockSdtNodes ?? Array.from(node.childNodes),
          depth + 1,
          ctx,
          p,
          out,
          false,
          pageBreak,
          extractPageBreakBlocks
        );
        continue;
      }
    }
    collectInline(node, depth, ctx, pending, p);
  }
  flush();
  if (ownsPageBreakState && pageBreak.pending) {
    appendPageBreak(out);
    pageBreak.pending = false;
    pageBreak.skipSpacer = false;
    p.lastMarkCovered = false;
  }
  // An explicit block emits its paragraph even when empty.
  if (forceEmit && out.length === before) {
    out.push(paragraphXml(ctx.para, []));
    p.lastMarkCovered = ctx.paragraphMarkCovered;
  }
}

// --- Tables

const TABLE_TOTAL_TWIPS = 9360; // 6.5 inches, Word's default content width.

type RowSpanCarry = { remaining: number; readonly span: number };

function projectTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const rows = tableRowsOf(table);
  if (rows.length === 0) return;

  // Count columns INCLUDING rowspan carry-over: a row that receives carried columns
  // still owns its trailing cells, which would otherwise be dropped. The pre-count
  // is bounded by its OWN copy of the remaining budget (so a crafted rowspan lattice
  // cannot spin) without consuming the shared budget the emission walk charges.
  let columns = 1;
  let precountLeft = p.nodesLeft;
  const carrySpans: Array<{ remaining: number; span: number }> = [];
  for (const row of rows) {
    if (precountLeft <= 0 || columns >= 63) break;
    let count = 0;
    let keep = 0;
    for (const carried of carrySpans) {
      count += carried.span;
      carried.remaining -= 1;
      if (carried.remaining > 0) carrySpans[keep++] = carried;
    }
    carrySpans.length = keep;
    for (const cell of Array.from(row.children)) {
      precountLeft -= 1;
      if (precountLeft <= 0) break;
      if (!/^t[dh]$/.test(tagOf(cell))) continue;
      const span = htmlSpanOf(cell, 'colspan', 63);
      count += span;
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1 && carrySpans.length < 63) {
        carrySpans.push({ remaining: rowSpan - 1, span });
      }
    }
    columns = Math.max(columns, count);
  }
  columns = Math.min(columns, 63);

  const totalWidth = tableWidthTwips(table, TABLE_TOTAL_TWIPS);
  const columnWidths = tableColumnWidths(rows, columns, totalWidth);
  const borders = tableBordersXml(table);
  const position = tablePositionXml(table);
  const justification = tableJustification(table);
  const jc = justification === undefined ? '' : `<w:jc w:val="${justification}"/>`;
  const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');

  const carry: Array<RowSpanCarry | null> = new Array<RowSpanCarry | null>(columns).fill(null);
  const rowXml: string[] = [];
  for (const row of rows) {
    if (p.nodesLeft <= 0) break;
    p.nodesLeft -= 1;
    // Snapshot the carries entering THIS row, then age every entry exactly once —
    // a colspan cell that jumps a carried column must not leave it un-aged.
    const carriedNow: Array<number | null> = carry.map((entry) => (entry ? entry.span : null));
    for (let index = 0; index < columns; index += 1) {
      const entry = carry[index];
      if (entry) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) carry[index] = null;
      }
    }
    const sourceCells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    const cells: string[] = [];
    let column = 0;
    while (column < columns) {
      p.nodesLeft -= 1;
      if (p.nodesLeft <= 0) break;
      const carriedSpan = carriedNow[column];
      if (carriedSpan !== null) {
        const gridSpan = carriedSpan > 1 ? `<w:gridSpan w:val="${carriedSpan}"/>` : '';
        cells.push(
          `<w:tc><w:tcPr>` +
            `<w:tcW w:w="${tableSpanWidth(columnWidths, column, carriedSpan)}" w:type="dxa"/>` +
            `${gridSpan}<w:vMerge/></w:tcPr><w:p/></w:tc>`
        );
        column += carriedSpan;
        continue;
      }
      const cell = sourceCells[sourceAt];
      if (cell === undefined) {
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[column]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
        );
        column += 1;
        continue;
      }
      sourceAt += 1;
      const span = Math.min(htmlSpanOf(cell, 'colspan', 63), columns - column);
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) carry[column] = { remaining: rowSpan - 1, span };
      cells.push(
        projectCell(
          cell,
          span,
          tableSpanWidth(columnWidths, column, span),
          rowSpan > 1,
          depth,
          ctx,
          p
        )
      );
      column += span;
    }
    rowXml.push(`<w:tr>${tableRowPropertiesXml(row)}${cells.join('')}</w:tr>`);
  }

  out.push(
    `<w:tbl><w:tblPr>${position}<w:tblW w:w="${totalWidth}" w:type="dxa"/>${jc}${borders}</w:tblPr>` +
      `<w:tblGrid>${grid}</w:tblGrid>${rowXml.join('')}</w:tbl>`
  );
  p.lastMarkCovered = false;
}

function projectCell(
  cell: Element,
  span: number,
  width: number,
  vMergeRestart: boolean,
  depth: number,
  ctx: FlowContext,
  p: Projection
): string {
  const isHeader = tagOf(cell) === 'th';
  let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`;
  if (vMergeRestart) tcPr += '<w:vMerge w:val="restart"/>';
  tcPr += cellCssPropertiesXml(cell);

  const cellCtx: FlowContext = {
    run: isHeader ? { ...ctx.run, bold: true } : ctx.run,
    para: isHeader ? { jc: 'center' } : {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
    ...(ctx.noteBody ? { noteBody: ctx.noteBody } : {}),
    ...(ctx.rels ? { rels: ctx.rels } : {}),
  };
  const blocks: string[] = [];
  projectFlow(Array.from(cell.childNodes), depth + 2, cellCtx, p, blocks, true);
  // A cell must end with a paragraph.
  if (blocks.length === 0 || blocks[blocks.length - 1]!.endsWith('</w:tbl>')) {
    blocks.push('<w:p/>');
  }
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${blocks.join('')}</w:tc>`;
}

function assembleFragment(p: Projection, blocks: readonly string[]): Uint8Array {
  return writeProjectedHtmlPackage({
    blocks,
    rels: p.rels,
    lists: [...p.lists.values()],
    notes: p.notes,
    noteRels: p.noteRels,
    media: p.media,
    mediaExtensions: p.mediaExtensions,
  });
}

type ProjectedBlocks =
  | { readonly ok: true; readonly projection: Projection; readonly blocks: string[] }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

/** The shared parse-and-walk half: everything up to (but not including) zip assembly. */
function projectBlocks(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const maxHtmlBytes = limits.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  // UTF-16 length is a lower bound on UTF-8 bytes, so the cheap check refuses first;
  // borderline payloads get an exact byte count.
  if (html.length > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  if (html.length * 3 > maxHtmlBytes) {
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (byteLength > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  }
  if (typeof DOMParser === 'undefined') return { ok: false, reason: 'parse-unavailable' };
  let parsed: Document;
  try {
    // The result stays detached. The bounded allowlist walker emits escaped XML only.
    // codeql[js/xss]
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { ok: false, reason: 'parse-unavailable' };
  }
  const body = parsed.body;
  if (!body) return { ok: false, reason: 'no-content' };

  const noteDefinitions = clipboardNoteDefinitions(parsed);
  const definedNotes: Record<ClipboardNoteKind, Set<number>> = {
    footnote: new Set(),
    endnote: new Set(),
  };
  const definedNoteElements = new Set<Element>();
  // Only definitions a body anchor actually references become notes; the rest stay
  // visible body text instead of unreachable note bodies.
  const referencedNotes: Record<ClipboardNoteKind, Set<number>> = {
    footnote: new Set(),
    endnote: new Set(),
  };
  // A definition body carries its own back-link anchor with the same id style; it
  // must not count as a body reference, or an orphan definition would be consumed.
  const definitionElements = new Set(noteDefinitions.map((note) => note.element));
  const insideDefinition = (element: Element): boolean => {
    let current: Element | null = element.parentElement;
    for (let hops = 0; current !== null && hops < 128; hops += 1) {
      if (definitionElements.has(current)) return true;
      current = current.parentElement;
    }
    return false;
  };
  const anchors = parsed.getElementsByTagName('a');
  for (let index = 0; index < anchors.length && index < 20_000; index += 1) {
    const anchor = anchors[index]!;
    const reference = clipboardNoteReference(parseInlineStyle(anchor));
    if (reference !== null && !insideDefinition(anchor)) {
      referencedNotes[reference.kind].add(reference.id);
    }
  }
  const projection: Projection = {
    nodesLeft: limits.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxImageBytes: limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    wordHtml: isWordClipboardHtml(html),
    lastMarkCovered: false,
    rels: [],
    media: new Map(),
    mediaExtensions: new Map(),
    lists: new Map(),
    semanticListCount: 0,
    imageCount: 0,
    docPrId: 0,
    nextBookmarkId: 1,
    classAlignments: wordClassAlignmentsFromDocument(parsed),
    listDefinitions: wordListDefinitionsFromStyleText(wordStyleTextFromDocument(parsed)),
    notes: { footnote: new Map(), endnote: new Map() },
    noteRels: { footnote: [], endnote: [] },
    definedNotes,
    definedNoteElements,
  };
  const rootCtx: FlowContext = {
    run: {},
    para: {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
  };
  // Notes project FIRST, so the body pass emits a live reference only for a note
  // whose body actually landed. A note the walk budget starved out stays out of
  // `definedNotes`, and its reference keeps the anchor's visible text instead of
  // pointing at a blank note. The notes may spend at most HALF the walk budget:
  // the body is the primary content and must never be starved into a refusal.
  const bodyReserve = Math.ceil(projection.nodesLeft / 2);
  projection.nodesLeft -= bodyReserve;
  for (const note of noteDefinitions) {
    if (projection.nodesLeft <= 0) break;
    // Unreferenced or duplicate-id definitions are left for the body walk.
    if (!referencedNotes[note.kind].has(note.id)) continue;
    if (projection.notes[note.kind].has(note.id)) continue;
    const noteBlocks: string[] = [];
    projectFlow(
      Array.from(note.element.childNodes),
      0,
      {
        ...rootCtx,
        noteBody: { kind: note.kind, id: note.id },
        rels: projection.noteRels[note.kind],
      },
      projection,
      noteBlocks,
      true
    );
    // A walk the budget starved mid-note stays unregistered (forceEmit would have
    // pushed an empty paragraph regardless), so the body walk keeps the text and
    // no live reference points at a blank note.
    if (projection.nodesLeft <= 0) break;
    if (noteBlocks.length > 0) {
      projection.notes[note.kind].set(note.id, noteBlocks);
      definedNotes[note.kind].add(note.id);
      definedNoteElements.add(note.element);
    }
  }
  projection.nodesLeft = Math.max(projection.nodesLeft, 0) + bodyReserve;
  projection.lastMarkCovered = false;
  const blocks: string[] = [];
  projectFlow(Array.from(body.childNodes), 0, rootCtx, projection, blocks);
  if (blocks.length === 0) return { ok: false, reason: 'no-content' };
  return { ok: true, projection, blocks };
}

// One paste gesture probes and projects the SAME string (in either order); the
// single-entry memo keeps the second call from re-running the full parse + walk on
// a multi-MiB payload. A scheduled clear drops the retained payload as soon as the
// gesture's synchronous handlers finish, so attacker-sized bytes never idle here.
let memoizedProjection: {
  readonly html: string;
  readonly limitsKey: string;
  readonly projected: ProjectedBlocks;
} | null = null;

function limitsKeyOf(limits: HtmlProjectionLimits): string {
  return `${limits.maxHtmlBytes ?? ''}:${limits.maxNodes ?? ''}:${limits.maxDepth ?? ''}:${limits.maxImageBytes ?? ''}`;
}

function projectBlocksMemoized(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const limitsKey = limitsKeyOf(limits);
  if (
    memoizedProjection !== null &&
    memoizedProjection.html === html &&
    memoizedProjection.limitsKey === limitsKey
  ) {
    return memoizedProjection.projected;
  }
  const projected = projectBlocks(html, limits);
  const entry = { html, limitsKey, projected };
  memoizedProjection = entry;
  setTimeout(() => {
    if (memoizedProjection === entry) memoizedProjection = null;
  }, 0);
  return projected;
}

/** Project external `text/html` into a bounded WordprocessingML fragment package. */
export function projectExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): HtmlProjectionResult {
  const projected = projectBlocksMemoized(html, limits);
  if (!projected.ok) return projected;
  return {
    ok: true,
    fragmentBytes: assembleFragment(projected.projection, projected.blocks),
    lastMarkCovered: projected.projection.lastMarkCovered,
    imageCount: projected.projection.imageCount,
  };
}

/** Probe projected content without paying for zip assembly. */
export function probeExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): { readonly lands: boolean; readonly imageCount: number } {
  const projected = projectBlocksMemoized(html, limits);
  if (!projected.ok) return { lands: false, imageCount: 0 };
  return { lands: true, imageCount: projected.projection.imageCount };
}
