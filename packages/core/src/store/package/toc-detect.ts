// Bounded, inert detection of cross-paragraph TOC complex fields.

import { isContentControl, isContentControlContent } from './content-control-walk.ts';
import { fldCharType, instrTextValue, isInstrTextNode } from './field-nodes.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import {
  TOC_MAX_FIELD_NESTING,
  TOC_MAX_INSTRUCTION_CHARS,
  parseTocInstruction,
  type TocInstruction,
} from './toc-instruction.ts';

/** A table of contents found in a document, whether wrapped in an SDT or a bare field. */
export interface DetectedToc {
  /** Enclosing control id when it identifies one TOC, otherwise the begin fldChar id. */
  readonly id: string;
  readonly beginNodeId: string;
  readonly beginParagraphId: string;
  readonly endParagraphId: string;
  readonly resultParagraphIds: readonly string[];
  /** Direct parent whose paragraph children delimit the cached result. */
  readonly containerId: string;
  readonly contentControlId?: string;
  readonly instruction: TocInstruction;
}

interface ParagraphSite {
  readonly paragraph: OoxmlElement;
  readonly containerId: string;
  readonly contentControlId?: string;
}

interface OpenField {
  readonly beginNodeId: string;
  readonly beginParagraphId: string;
  readonly containerId: string;
  readonly contentControlId?: string;
  readonly instructionChunks: string[];
  readonly resultParagraphIds: string[];
  instructionLength: number;
  separated: boolean;
  invalid: boolean;
}

function bodyOf(part: OoxmlPart): OoxmlElement | null {
  if (part.root.kind === 'body') return part.root;
  for (const child of part.root.children) {
    if (child.kind === 'body') return child;
  }
  return null;
}

function paragraphSites(part: OoxmlPart): ParagraphSite[] {
  const body = bodyOf(part);
  if (!body) return [];
  const sites: ParagraphSite[] = [];

  const collect = (
    children: readonly OoxmlNode[],
    containerId: string,
    contentControlId: string | undefined,
    depth: number
  ): void => {
    for (const child of children) {
      if (child.kind === 'paragraph') {
        sites.push({ paragraph: child, containerId, contentControlId });
        continue;
      }
      if (!isContentControl(child) || depth >= TOC_MAX_FIELD_NESTING) continue;
      for (const content of child.children) {
        if (isContentControlContent(content)) {
          collect(content.children, content.id, child.id, depth + 1);
        }
      }
    }
  };
  collect(body.children, body.id, undefined, 0);
  return sites;
}

const fieldTokensByParagraph = new WeakMap<OoxmlElement, readonly OoxmlNode[]>();

function fieldTokens(paragraph: OoxmlElement): readonly OoxmlNode[] {
  const cached = fieldTokensByParagraph.get(paragraph);
  if (cached) return cached;
  const tokens: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (fldCharType(node) !== null || isInstrTextNode(node)) {
      tokens.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of paragraph.children) walk(child);
  fieldTokensByParagraph.set(paragraph, tokens);
  return tokens;
}

/** Memoized per immutable part identity; a commit replaces the part object. */
const detectBodyTocsCache = new WeakMap<OoxmlPart, readonly DetectedToc[]>();

function detectBodyTocsUncached(part: OoxmlPart): readonly DetectedToc[] {
  const stack: (OpenField | null)[] = [];
  const completed: Omit<DetectedToc, 'id'>[] = [];

  for (const site of paragraphSites(part)) {
    for (const token of fieldTokens(site.paragraph)) {
      const type = fldCharType(token);
      if (type === 'begin') {
        if (stack.length >= TOC_MAX_FIELD_NESTING) {
          stack.push(null);
        } else {
          stack.push({
            beginNodeId: token.id,
            beginParagraphId: site.paragraph.id,
            containerId: site.containerId,
            contentControlId: site.contentControlId,
            instructionChunks: [],
            resultParagraphIds: [],
            instructionLength: 0,
            separated: false,
            invalid: false,
          });
        }
        continue;
      }

      const field = stack[stack.length - 1];
      if (isInstrTextNode(token)) {
        if (field && !field.separated) {
          const chunk = instrTextValue(token);
          field.instructionLength += chunk.length;
          if (field.instructionLength > TOC_MAX_INSTRUCTION_CHARS) field.invalid = true;
          else field.instructionChunks.push(chunk);
        }
        continue;
      }
      if (type === 'separate') {
        if (field) field.separated = true;
        continue;
      }
      if (type !== 'end' || stack.length === 0) continue;

      const ended = stack.pop();
      if (
        ended &&
        ended.separated &&
        !ended.invalid &&
        ended.containerId === site.containerId &&
        ended.beginParagraphId !== site.paragraph.id
      ) {
        const instruction = parseTocInstruction(ended.instructionChunks.join(''));
        if (instruction) {
          completed.push({
            beginNodeId: ended.beginNodeId,
            beginParagraphId: ended.beginParagraphId,
            endParagraphId: site.paragraph.id,
            resultParagraphIds: ended.resultParagraphIds,
            containerId: ended.containerId,
            ...(ended.contentControlId ? { contentControlId: ended.contentControlId } : {}),
            instruction,
          });
        }
      }
    }

    for (const field of stack) {
      if (
        field &&
        field.separated &&
        field.beginParagraphId !== site.paragraph.id &&
        field.containerId === site.containerId
      ) {
        field.resultParagraphIds.push(site.paragraph.id);
      }
    }
  }

  const controlCounts = new Map<string, number>();
  for (const toc of completed) {
    if (toc.contentControlId) {
      controlCounts.set(toc.contentControlId, (controlCounts.get(toc.contentControlId) ?? 0) + 1);
    }
  }
  return completed.map((toc) => ({
    ...toc,
    id:
      toc.contentControlId && controlCounts.get(toc.contentControlId) === 1
        ? toc.contentControlId
        : toc.beginNodeId,
  }));
}

/** Discover refreshable body TOCs without evaluating any field instruction. */
export function detectBodyTocs(part: OoxmlPart): readonly DetectedToc[] {
  const cached = detectBodyTocsCache.get(part);
  if (cached) return cached;
  const result = detectBodyTocsUncached(part);
  detectBodyTocsCache.set(part, result);
  return result;
}

/** Locate the table of contents containing a position, or null. */
export function findDetectedToc(tocs: readonly DetectedToc[], tocId: string): DetectedToc | null {
  return tocs.find((toc) => toc.id === tocId) ?? null;
}
