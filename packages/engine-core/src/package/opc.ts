// Minimal OPC package reader/writer (document-engine tasks 2.7 partial, 3.6, 3.7).
// parseDocx: DOCX bytes -> authored PackageModel (body story paragraphs/runs +
// content types + root relationship). writeDocx: PackageModel -> valid minimal
// DOCX bytes. Attacker-derived text is XML-escaped on write; the reader goes
// through the bounded ZIP + XML trust boundary. This is the parse<->serialize
// round-trip that gate 5 (parse->edit->save->reopen) exercises.

import { readZip, writeZip, strToU8, strFromU8, type ZipRejection } from './zip.ts';
import { readXml, findElement, childElements, textContent, type XmlNode } from './xml-reader.ts';
import { escapeXml } from './sinks.ts';
import { resolveInternalTarget } from './opc-names.ts';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type Story,
  type ParagraphRecord,
  type RunRecord,
  type RunProps,
} from '../model/index.ts';
import { IdentityAllocator } from '../model/identity.ts';

export type DocxParseRejection = ZipRejection | 'no-document' | 'xml-error';

export type ParseResult =
  | { readonly ok: true; readonly model: PackageModel }
  | { readonly ok: false; readonly reason: DocxParseRejection; readonly detail?: string };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function el(node: XmlNode): node is Extract<XmlNode, { type: 'element' }> {
  return node.type === 'element';
}

// Run-wrapping elements whose child w:r must still be collected (OOXML review).
const RUN_WRAPPERS = new Set(['w:hyperlink', 'w:ins', 'w:del', 'w:smartTag', 'w:sdt', 'w:sdtContent']);

/** Collect every w:r element under a node, recursing through run wrappers. */
function collectRunElements(node: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const runs: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of node.children) {
    if (!el(child)) continue;
    if (child.name === 'w:r') runs.push(child);
    else if (RUN_WRAPPERS.has(child.name)) runs.push(...collectRunElements(child));
  }
  return runs;
}

/**
 * Parse a run element into an authored run. Reads ALL w:t segments in order and
 * maps w:tab/w:br/w:cr/w:noBreakHyphen to their characters (so a break-only run
 * is not dropped). Reads w:rPr bold/italic.
 */
function parseRun(run: Extract<XmlNode, { type: 'element' }>): RunRecord | undefined {
  let text = '';
  for (const child of run.children) {
    if (!el(child)) continue;
    switch (child.name) {
      case 'w:t':
        text += textContent(child);
        break;
      case 'w:tab':
        text += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        text += '\n';
        break;
      case 'w:noBreakHyphen':
        text += '‑';
        break;
    }
  }
  const rPr = childElements(run, 'w:rPr')[0];
  const props: RunProps = {};
  if (rPr) {
    if (childElements(rPr, 'w:b').length > 0) (props as { bold?: boolean }).bold = true;
    if (childElements(rPr, 'w:i').length > 0) (props as { italic?: boolean }).italic = true;
  }
  if (text.length === 0 && Object.keys(props).length === 0) return undefined;
  return Object.keys(props).length > 0 ? { text, props } : { text };
}

/**
 * Collect every paragraph (w:p) under a container, recovering text from tables
 * (w:tbl › w:tr › w:tc) and block SDT (w:sdt › w:sdtContent) by flattening their
 * cell/content paragraphs. Structural table fidelity is a follow-up; this recovers
 * the text the review found was 100% lost.
 */
function collectParagraphElements(container: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const paras: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p') paras.push(child);
    else if (child.name === 'w:tbl') {
      for (const row of childElements(child, 'w:tr')) {
        for (const cell of childElements(row, 'w:tc')) paras.push(...collectParagraphElements(cell));
      }
    } else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) paras.push(...collectParagraphElements(content));
    }
  }
  return paras;
}

/** Collect every `Relationship` element from a rels part's tree. */
function allRelationships(nodes: readonly XmlNode[]): Extract<XmlNode, { type: 'element' }>[] {
  const out: Extract<XmlNode, { type: 'element' }>[] = [];
  const walk = (ns: readonly XmlNode[]): void => {
    for (const n of ns) {
      if (!el(n)) continue;
      if (n.name === 'Relationship') out.push(n);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// Related-story parts: rel-type suffix -> { model story kind, part root element,
// and (for note/comment collections) the per-item wrapper element }.
interface StorySpec {
  readonly kind: 'header' | 'footer' | 'footnote' | 'endnote' | 'comment';
  readonly root: string;
  readonly item?: string;
}
const STORY_SPECS: Record<string, StorySpec> = {
  '/header': { kind: 'header', root: 'w:hdr' },
  '/footer': { kind: 'footer', root: 'w:ftr' },
  '/footnotes': { kind: 'footnote', root: 'w:footnotes', item: 'w:footnote' },
  '/endnotes': { kind: 'endnote', root: 'w:endnotes', item: 'w:endnote' },
  '/comments': { kind: 'comment', root: 'w:comments', item: 'w:comment' },
};

/** Related-story parts referenced by document.xml's relationships (internal only). */
function relatedStoryParts(entries: ReadonlyMap<string, Uint8Array>): { partName: string; spec: StorySpec }[] {
  const relsPart = entries.get('/word/_rels/document.xml.rels');
  if (!relsPart) return [];
  const rx = readXml(strFromU8(relsPart));
  if (!rx.ok) return [];
  const out: { partName: string; spec: StorySpec }[] = [];
  for (const rel of allRelationships(rx.nodes)) {
    if (rel.attributes.TargetMode === 'External') continue;
    const type = rel.attributes.Type ?? '';
    const suffix = Object.keys(STORY_SPECS).find((s) => type.endsWith(s));
    if (!suffix) continue;
    const resolved = resolveInternalTarget('/word/document.xml', rel.attributes.Target ?? '');
    if (resolved.ok) out.push({ partName: resolved.partName, spec: STORY_SPECS[suffix] });
  }
  return out;
}

function parseStoryParagraphs(root: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord[] {
  return collectParagraphElements(root).map((p) => {
    const runs: RunRecord[] = [];
    for (const runEl of collectRunElements(p)) {
      const run = parseRun(runEl);
      if (run) runs.push(run);
    }
    return { kind: 'paragraph', id: alloc.allocate('paragraph'), runs };
  });
}

export function parseDocx(bytes: Uint8Array): ParseResult {
  const zip = readZip(bytes);
  if (!zip.ok) return { ok: false, reason: zip.reason, detail: zip.detail };
  const docPart = zip.entries.get('/word/document.xml');
  if (!docPart) return { ok: false, reason: 'no-document' };

  const xml = readXml(strFromU8(docPart));
  if (!xml.ok) return { ok: false, reason: 'xml-error', detail: xml.reason };

  const body = findElement(xml.nodes, 'w:body');
  const alloc = new IdentityAllocator();
  const storyId = alloc.allocate('story');
  const blocks: ParagraphRecord[] = [];
  if (body) {
    for (const p of collectParagraphElements(body)) {
      const runs: RunRecord[] = [];
      for (const runEl of collectRunElements(p)) {
        const run = parseRun(runEl);
        if (run) runs.push(run);
      }
      blocks.push({ kind: 'paragraph', id: alloc.allocate('paragraph'), runs });
    }
  }
  if (blocks.length === 0) blocks.push({ kind: 'paragraph', id: alloc.allocate('paragraph'), runs: [] });

  const base = createEmptyModel();
  const stories = new Map<string, Story>();
  stories.set(storyId, { id: storyId, kind: 'body', blocks });

  // Related stories: header/footer/footnote/endnote/comment (OOXML-review gap #5)
  // — text previously lost because only word/document.xml was read.
  for (const { partName, spec } of relatedStoryParts(zip.entries)) {
    const part = zip.entries.get(partName);
    if (!part) continue;
    const sx = readXml(strFromU8(part));
    if (!sx.ok) continue;
    const root = findElement(sx.nodes, spec.root);
    if (!root) continue;
    // Note/comment collections wrap each entry (w:footnote/w:endnote/w:comment);
    // header/footer content is directly under the root.
    const containers = spec.item ? childElements(root, spec.item) : [root];
    const blocks: ParagraphRecord[] = [];
    for (const container of containers) blocks.push(...parseStoryParagraphs(container, alloc));
    const sid = alloc.allocate('story');
    stories.set(sid, { id: sid, kind: spec.kind, blocks });
  }

  return { ok: true, model: { ...base, stories, identity: alloc.state() } };
}

function runXml(run: RunRecord): string {
  const props = run.props;
  const rPr =
    props?.bold || props?.italic
      ? `<w:rPr>${props.bold ? '<w:b/>' : ''}${props.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function paragraphXml(p: ParagraphRecord): string {
  return `<w:p>${p.runs.map(runXml).join('')}</w:p>`;
}

/** Serialize the body story into a document.xml string. */
export function documentXml(model: PackageModel): string {
  const story = model.stories.get(bodyStoryId(model))!;
  const body = story.blocks.map((b) => paragraphXml(b as ParagraphRecord)).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

/** Serialize a PackageModel into valid minimal DOCX bytes. */
export function writeDocx(model: PackageModel): Uint8Array {
  const entries = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', strToU8(CONTENT_TYPES_XML)],
    ['/_rels/.rels', strToU8(ROOT_RELS_XML)],
    ['/word/document.xml', strToU8(documentXml(model))],
  ]);
  return writeZip(entries);
}
