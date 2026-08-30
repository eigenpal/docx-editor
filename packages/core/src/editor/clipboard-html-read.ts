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
import { createGestureMemo } from './clipboard-html-memo.ts';
import { clipboardLanguageTag } from './clipboard-html-language.ts';
import {
  writeProjectedHtmlPackage,
  type HtmlFragmentRel as RelEntry,
} from './clipboard-html-package.ts';
import {
  clipboardNoteDefinitions,
  clipboardNoteReference,
  collectReferencedNoteIds,
  isClipboardNoteList,
  type ClipboardNoteKind,
} from './clipboard-html-notes.ts';
import {
  HEADING_SZ,
  appendPageBreak,
  paragraphXml,
  rPrXml,
  textRunXml,
} from './clipboard-html-run-xml.ts';
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
import { projectHtmlTable } from './clipboard-html-table-project.ts';
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

type RunProps = HtmlRunProps;
type ParaProps = HtmlParaProps;

type ListState = { readonly numId: string; readonly level: number };

export interface FlowContext {
  readonly run: RunProps;
  readonly para: ParaProps;
  readonly paragraphMarkCovered: boolean;
  readonly pre: boolean;
  readonly list: ListState | null;
  /** Set while projecting a note definition body: the note the blocks belong to. */
  readonly noteBody?: { readonly kind: ClipboardNoteKind; readonly id: number };
  readonly rels?: RelEntry[];
}

export interface Projection {
  nodesLeft: number;
  /** Set when a walk stopped with work remaining because the budget ran out. */
  truncated: boolean;
  readonly maxDepth: number;
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  lastMarkCovered: boolean;
  readonly rels: RelEntry[];
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
  readonly lists: Map<string, ListAllocation>;
  /** Secondary index over `lists`, so nested lists resolve without a linear scan. */
  readonly listsByNumId: Map<string, ListAllocation>;
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
  /** Ids whose reference the body walk actually EMITTED; a claimed note without one
   *  is reconciled back into visible body text after the walk. */
  readonly emittedNoteRefs: Record<ClipboardNoteKind, Set<number>>;
  /** The exact definition elements the notes pass consumed; only these skip the body
   *  walk, so a duplicate-id or unreferenced definition stays lossless in the body. */
  readonly definedNoteElements: ReadonlySet<Element>;
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
  const allocation: ListAllocation = { numId, levels: new Map([[level, { kind, start }]]) };
  p.lists.set(key, allocation);
  p.listsByNumId.set(numId, allocation);
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
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
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
    // The tab run carries the SPAN's own formatting (an underlined leader keeps its
    // underline), not just the parent context's.
    const tabRun = applyRunCss(applyInlineTag(ctx.run, tag), style);
    runs.push(`<w:r>${rPrXml(tabRun)}${tabContent}</w:r>`);
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
    // Word renders note marks superscript via a character style the fragment does
    // not carry; direct formatting keeps the number off the baseline.
    const markRun: RunProps = { vertAlign: 'superscript', ...nextCtx.run };
    if (
      ctx.noteBody !== undefined &&
      ctx.noteBody.kind === noteReference.kind &&
      ctx.noteBody.id === noteReference.id
    ) {
      // The note's own number mark, inside its own body.
      const localName = noteReference.kind === 'footnote' ? 'footnoteRef' : 'endnoteRef';
      runs.push(`<w:r>${rPrXml(markRun)}<w:${localName}/></w:r>`);
      return;
    }
    if (ctx.noteBody === undefined && p.definedNotes[noteReference.kind].has(noteReference.id)) {
      const localName =
        noteReference.kind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
      runs.push(`<w:r>${rPrXml(markRun)}<w:${localName} w:id="${noteReference.id}"/></w:r>`);
      p.emittedNoteRefs[noteReference.kind].add(noteReference.id);
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
  p: Projection,
  noteBody: FlowContext['noteBody']
): ParaProps['numPr'] {
  const declaration = style.get('mso-list');
  if (declaration === undefined) return undefined;
  const match = /\bl(\d{1,4})\s+level(\d{1,2})\b/i.exec(declaration);
  if (!match) return undefined;
  const ilvl = Math.min(Math.max(Number.parseInt(match[2]!, 10) - 1, 0), 8);
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
  // A note body's list must not seed the body list's first-observation state — the
  // notes project first, and their markers would pin the body's start values.
  const scope = noteBody === undefined ? '' : `${noteBody.kind}${noteBody.id}:`;
  const key = `mso:${scope}l${match[1]}${lfo ? `:lfo${lfo[1]}` : ''}`;
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
  const mso = msoListNumPr(element, style, p, ctx.noteBody);
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
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
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
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
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
    const allocation = p.listsByNumId.get(state.numId);
    if (allocation !== undefined && !allocation.levels.has(state.level)) {
      allocation.levels.set(state.level, { kind, start: semanticHtmlListStart(element) });
    }
  }
  const itemCtx: FlowContext = {
    ...ctx,
    list: state,
    para: { numPr: { numId: state.numId, ilvl: state.level } },
  };
  let pendingPageBreak = pageBreakBefore;
  for (const child of Array.from(element.childNodes)) {
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    if (!isElement(child)) continue;
    const childTag = tagOf(child);
    if (childTag === 'li') {
      // Each item charges the walk budget HERE (the flow loop is not involved), so
      // a flood of empty auto-closed `<li>`s cannot emit blocks at zero cost.
      p.nodesLeft -= 1;
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
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    if (isElement(node)) {
      const tag = tagOf(node);
      const blockSdtNodes = tag === 'w:sdt' ? wordBlockSdtNodes(node) : null;
      if (extractPageBreakBlocks && isWordPageBreakBlock(node)) {
        flush();
        p.nodesLeft -= 1;
        // Consecutive break blocks: materialize the earlier one so an intentionally
        // blank page survives instead of the two breaks collapsing into one.
        if (pageBreak.pending) appendPageBreak(out);
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
      // A span wrapping block children behaves as a block container (browsers do the
      // same for block-in-inline); flattened SDT wrappers rely on this transparency.
      if (
        CONTAINER_TAGS.has(tag) ||
        blockSdtNodes !== null ||
        (tag === 'span' && hasBlockChild(node))
      ) {
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

// --- Tables (clipboard-html-table-project.ts owns the walk)

function projectTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  projectHtmlTable(table, depth, ctx, p, out, projectFlow);
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
  collectReferencedNoteIds(parsed, noteDefinitions, referencedNotes);
  const projection: Projection = {
    nodesLeft: limits.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxImageBytes: limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    wordHtml: isWordClipboardHtml(html),
    truncated: false,
    lastMarkCovered: false,
    rels: [],
    media: new Map(),
    mediaExtensions: new Map(),
    lists: new Map(),
    listsByNumId: new Map(),
    semanticListCount: 0,
    imageCount: 0,
    docPrId: 0,
    nextBookmarkId: 1,
    classAlignments: wordClassAlignmentsFromDocument(parsed),
    listDefinitions: wordListDefinitionsFromStyleText(wordStyleTextFromDocument(parsed)),
    notes: { footnote: new Map(), endnote: new Map() },
    noteRels: { footnote: [], endnote: [] },
    definedNotes,
    emittedNoteRefs: { footnote: new Set(), endnote: new Set() },
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
  // Claim (dedupe + reference-gate) and PRE-register the claimed elements, so an
  // outer definition's body walk skips a nested definition it does not own.
  const claimed: (typeof noteDefinitions)[number][] = [];
  for (const note of noteDefinitions) {
    if (!referencedNotes[note.kind].has(note.id)) continue;
    if (definedNotes[note.kind].has(note.id)) continue;
    definedNotes[note.kind].add(note.id);
    definedNoteElements.add(note.element);
    claimed.push(note);
  }
  // Project INNER definitions before their containers: if truncation un-claims the
  // tail, an un-claimed inner note then projects inside its outer's body (or the
  // document body) instead of being stranded by an already-projected outer.
  const domDepthOf = (element: Element): number => {
    let depth = 0;
    let current = element.parentElement;
    while (current !== null && depth < 256) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };
  claimed.sort((a, b) => domDepthOf(b.element) - domDepthOf(a.element));
  for (let index = 0; index < claimed.length; index += 1) {
    const note = claimed[index]!;
    projection.truncated = false;
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
    if (projection.truncated || noteBlocks.length === 0) {
      // The budget starved this walk mid-note: un-claim this and every remaining
      // definition so the body walk keeps their text and no live reference points
      // at a blank or truncated note.
      for (let drop = index; drop < claimed.length; drop += 1) {
        const dropped = claimed[drop]!;
        definedNotes[dropped.kind].delete(dropped.id);
        definedNoteElements.delete(dropped.element);
        projection.notes[dropped.kind].delete(dropped.id);
      }
      break;
    }
    projection.notes[note.kind].set(note.id, noteBlocks);
  }
  projection.nodesLeft = Math.max(projection.nodesLeft, 0) + bodyReserve;
  projection.truncated = false;
  projection.lastMarkCovered = false;
  const blocks: string[] = [];
  projectFlow(Array.from(body.childNodes), 0, rootCtx, projection, blocks);
  // Reconcile: a claimed note whose reference the body walk never emitted (anchor
  // past the budget, inside dropped chrome, or too deep) would be silently dropped
  // by the merge as unreferenced. Move its text back into the body, re-homing any
  // note-scoped rel references onto document rels. The attribute-shaped pattern
  // cannot match run TEXT: escapeXml turns a literal quote into `&quot;`.
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const [id, noteBlocks] of [...projection.notes[kind]]) {
      if (projection.emittedNoteRefs[kind].has(id)) continue;
      projection.notes[kind].delete(id);
      definedNotes[kind].delete(id);
      const relIdMap = new Map<string, string>();
      for (const block of noteBlocks) {
        // Drop the note's own number mark; it has no meaning in body flow. The
        // patterns only ever match XML this projection just emitted.
        const moved = block
          // Tempered so the optional rPr scan can never cross a run boundary.
          .replace(
            /<w:r>(?:<w:rPr>(?:(?!<\/w:r>)[\s\S])*?<\/w:rPr>)?<w:(?:footnote|endnote)Ref\/><\/w:r>/g,
            ''
          )
          .replace(/ r:(id|embed)="([^"]{1,32})"/g, (whole, attribute: string, oldId: string) => {
            let mapped = relIdMap.get(oldId);
            if (mapped === undefined) {
              const source = projection.noteRels[kind].find((rel) => rel.id === oldId);
              if (source === undefined) return whole;
              mapped = allocateRel(projection, source.type, source.target, source.external);
              relIdMap.set(oldId, mapped);
            }
            return ` r:${attribute}="${mapped}"`;
          });
        blocks.push(moved);
      }
    }
  }
  if (blocks.length === 0) return { ok: false, reason: 'no-content' };
  return { ok: true, projection, blocks };
}

const projectionMemo = createGestureMemo<ProjectedBlocks>();

function projectBlocksMemoized(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const limitsKey = `${limits.maxHtmlBytes ?? ''}:${limits.maxNodes ?? ''}:${limits.maxDepth ?? ''}:${limits.maxImageBytes ?? ''}`;
  return projectionMemo(html, limitsKey, () => projectBlocks(html, limits));
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
