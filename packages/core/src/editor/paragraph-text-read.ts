import { findNode, paragraphOffsetIndex } from '@docx-editor.dev/core/store';
import { allParagraphs } from '../binding/tree-binding.ts';
import type {
  EditorParagraphText,
  ParagraphText,
  ParagraphTextSpan,
} from '../contracts/editor-paragraph-text.ts';
import { withFieldResultsMode, type FieldResultsMode } from '../store/package/field-result-mode.ts';
import {
  hyphenTextOf,
  isSymbolElement,
  NON_BREAKING_HYPHEN_TEXT,
  OPTIONAL_HYPHEN_TEXT,
} from '../store/package/hyphen-text.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { paragraphModelTextOf } from '../store/store/paragraph-model-text.ts';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';

function readParagraph(
  paragraph: OoxmlParagraphNode,
  fieldResults: FieldResultsMode
): ParagraphText {
  return withFieldResultsMode(fieldResults, () => {
    const text = paragraphModelTextOf(paragraph);
    const index = paragraphOffsetIndex(paragraph);
    // Model offsets a reader does not see as text: tracked deletions, move sources and
    // optional hyphens. Kept text skips them; a span ends at each one.
    const gaps: { start: number; end: number }[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
        const span = index.spanOf(node);
        if (span && span.end > span.start) gaps.push(span);
        return;
      }
      if ('children' in node) for (const child of node.children) visit(child);
    };
    for (const child of paragraph.children) visit(child);
    // Placeholder characters read as what they show, one for one, so span lengths still
    // hold in both texts: a symbol is an object, a non-breaking hyphen is U+2011.
    const shown = new Map<number, string>();
    for (const segment of index.segments) {
      if (segment.end - segment.start !== 1) continue;
      const hyphen = hyphenTextOf(segment.node);
      if (hyphen === OPTIONAL_HYPHEN_TEXT) gaps.push(segment);
      else if (hyphen === NON_BREAKING_HYPHEN_TEXT) shown.set(segment.start, '‑');
      else if (isSymbolElement(segment.node)) shown.set(segment.start, '￼');
    }
    gaps.sort((a, b) => a.start - b.start);
    const keptSpans: ParagraphTextSpan[] = [];
    let keptText = '';
    let cursor = 0;
    const keepUntil = (end: number): void => {
      if (end <= cursor) return;
      keptSpans.push(
        Object.freeze({ start: cursor, length: end - cursor, keptStart: keptText.length })
      );
      if (shown.size === 0) keptText += text.slice(cursor, end);
      else for (let at = cursor; at < end; at += 1) keptText += shown.get(at) ?? text[at];
      cursor = end;
    };
    for (const gap of gaps) {
      keepUntil(gap.start);
      cursor = Math.max(cursor, gap.end);
    }
    keepUntil(text.length);
    return Object.freeze({
      blockId: paragraph.id,
      text,
      keptText,
      keptSpans: Object.freeze(keptSpans),
    });
  });
}

export function createParagraphTextReads(deps: {
  surface(): PaginatedSurface | null;
  fieldResults: FieldResultsMode;
}): EditorParagraphText {
  const paragraphs = new WeakMap<OoxmlParagraphNode, ParagraphText>();
  const parts = createRecentRootCache<readonly ParagraphText[]>(16);
  let previousParts: readonly OoxmlPart[] = [];
  let result: readonly ParagraphText[] = Object.freeze([]);
  const read = (paragraph: OoxmlParagraphNode): ParagraphText => {
    let value = paragraphs.get(paragraph);
    if (!value) {
      value = readParagraph(paragraph, deps.fieldResults);
      paragraphs.set(paragraph, value);
    }
    return value;
  };
  const readPart = (part: OoxmlPart): readonly ParagraphText[] => {
    const cached = parts.get(part);
    if (cached) return cached;
    const boxes = new Map<string, OoxmlNode[]>();
    for (const box of textboxStoriesInPart(part)) {
      const nested = boxes.get(box.hostParagraphId) ?? [];
      nested.push(...storyParagraphs(box.root));
      boxes.set(box.hostParagraphId, nested);
    }
    const values: ParagraphText[] = [];
    for (const paragraph of allParagraphs(part)) {
      if (paragraph.kind !== 'paragraph') continue;
      values.push(read(paragraph));
      for (const nested of boxes.get(paragraph.id) ?? []) {
        if (nested.kind === 'paragraph') values.push(read(nested));
      }
    }
    const frozen = Object.freeze(values);
    parts.set(part, frozen);
    return frozen;
  };
  return {
    getParagraphText(blockId) {
      const surface = deps.surface();
      const part = surface ? partOfNodeId(surface.session, blockId) : null;
      const paragraph = part ? findNode(part, blockId) : null;
      return paragraph?.kind === 'paragraph' ? read(paragraph) : null;
    },
    getParagraphs() {
      const currentParts = deps.surface()?.session.storyParts() ?? [];
      if (
        currentParts.length !== previousParts.length ||
        currentParts.some((part, i) => part !== previousParts[i])
      ) {
        result = Object.freeze(currentParts.flatMap(readPart));
        previousParts = currentParts;
      }
      return result;
    },
  };
}
