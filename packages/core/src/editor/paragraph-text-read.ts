import {
  buildStyleCascadeTable,
  createRunProofingReader,
  type RunProofing,
  type StyleCascadeTable,
} from '@docx-editor.dev/core/layout';
import { findNode, paragraphOffsetIndex, type OoxmlElement } from '@docx-editor.dev/core/store';
import { allParagraphs } from '../binding/tree-binding.ts';
import type {
  EditorParagraphText,
  ParagraphText,
  ParagraphTextProofing,
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

type RunProofingReader = (paragraph: OoxmlParagraphNode, run: OoxmlNode) => RunProofing;

/** A stretch of model text with one set of proofing settings. */
interface ProofedRange {
  readonly start: number;
  readonly end: number;
  readonly lang: string | null;
  readonly noProof: boolean;
}

/** `ranges` in `keptText` offsets: stretches that share settings merge, and gaps get none. */
function keptProofing(
  ranges: readonly ProofedRange[],
  keptSpans: readonly ParagraphTextSpan[],
  keptLength: number
): readonly ParagraphTextProofing[] {
  const result: ParagraphTextProofing[] = [];
  const push = (keptStart: number, length: number, lang: string | null, noProof: boolean) => {
    const last = result.at(-1);
    if (last && last.lang === lang && last.noProof === noProof) {
      result[result.length - 1] = { ...last, length: last.length + length };
    } else result.push({ keptStart, length, lang, noProof });
  };
  let next = 0;
  for (const span of keptSpans) {
    for (let at = span.start; at < span.start + span.length;) {
      while (next < ranges.length && ranges[next]!.end <= at) next++;
      const range = ranges[next];
      const inside = range !== undefined && range.start <= at;
      // Text outside every run, such as a simple field, takes no language and is checked.
      const end = Math.min(
        span.start + span.length,
        inside ? range.end : (range?.start ?? Infinity)
      );
      push(
        at - span.start + span.keptStart,
        end - at,
        inside ? range.lang : null,
        inside && range.noProof
      );
      at = end;
    }
  }
  if (result.length === 0 && keptLength > 0) push(0, keptLength, null, false);
  return Object.freeze(result.map((entry) => Object.freeze(entry)));
}

function readParagraph(
  paragraph: OoxmlParagraphNode,
  fieldResults: FieldResultsMode,
  proofingOf: RunProofingReader
): ParagraphText {
  return withFieldResultsMode(fieldResults, () => {
    const text = paragraphModelTextOf(paragraph);
    const index = paragraphOffsetIndex(paragraph);
    // Model offsets a reader does not see as text: tracked deletions, move sources, hidden
    // runs and optional hyphens. Kept text skips them; a span ends at each one.
    const gaps: { start: number; end: number }[] = [];
    const runs: ProofedRange[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') {
        const span = index.spanOf(node);
        if (span && span.end > span.start) gaps.push(span);
        return;
      }
      if (node.kind === 'run') {
        const span = index.spanOf(node);
        if (span && span.end > span.start) {
          const proofing = proofingOf(paragraph, node);
          if (proofing.hidden) gaps.push(span);
          else runs.push({ ...span, lang: proofing.lang, noProof: proofing.noProof });
        }
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
      else if (hyphen === NON_BREAKING_HYPHEN_TEXT) shown.set(segment.start, '\u2011');
      else if (isSymbolElement(segment.node)) shown.set(segment.start, '\uFFFC');
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
    runs.sort((a, b) => a.start - b.start);
    return Object.freeze({
      blockId: paragraph.id,
      text,
      keptText,
      keptSpans: Object.freeze(keptSpans),
      proofing: keptProofing(runs, keptSpans, keptText.length),
    });
  });
}

export function createParagraphTextReads(deps: {
  surface(): PaginatedSurface | null;
  fieldResults: FieldResultsMode;
}): EditorParagraphText {
  const paragraphs = new WeakMap<OoxmlParagraphNode, ParagraphText>();
  // The styles part does not change during a session, so one reader serves every paragraph.
  let proofing: { root: OoxmlElement | null; read: RunProofingReader } | undefined;
  const proofingReader = (): RunProofingReader => {
    const session = deps.surface()?.session;
    const root = session?.stylesRoot() ?? null;
    if (!proofing || proofing.root !== root) {
      const styles: StyleCascadeTable | undefined = root
        ? buildStyleCascadeTable(root, session?.documentThemeFonts())
        : undefined;
      proofing = { root, read: createRunProofingReader(styles) };
    }
    return proofing.read;
  };
  const parts = createRecentRootCache<readonly ParagraphText[]>(16);
  const listedIn = new WeakMap<OoxmlPart, ReadonlySet<ParagraphText>>();
  let previousParts: readonly OoxmlPart[] = [];
  let result: readonly ParagraphText[] = Object.freeze([]);
  const read = (paragraph: OoxmlParagraphNode): ParagraphText => {
    let value = paragraphs.get(paragraph);
    if (!value) {
      value = readParagraph(paragraph, deps.fieldResults, proofingReader());
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
      if (!part || !surface!.session.storyParts().includes(part)) return null;
      const paragraph = findNode(part, blockId);
      if (paragraph?.kind !== 'paragraph') return null;
      // Only paragraphs that getParagraphs() lists: never a fallback copy of a text box.
      const value = read(paragraph);
      let listed = listedIn.get(part);
      if (!listed) listedIn.set(part, (listed = new Set(readPart(part))));
      return listed.has(value) ? value : null;
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
