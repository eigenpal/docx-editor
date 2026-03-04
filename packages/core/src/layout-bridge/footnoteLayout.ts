/**
 * Footnote Layout Utilities
 *
 * Handles scanning for footnote references, mapping them to pages,
 * converting footnote content to measurable FlowBlocks, and computing
 * per-page footnote area heights for layout space reservation.
 */

import type {
  FlowBlock,
  Measure,
  Page,
  ParagraphBlock,
  Run,
  TextRun,
  RunFormatting,
  FootnoteContent,
} from '../layout-engine/types';
import type { Footnote } from '../types/document';
import { measureParagraph } from './measuring';

/** Separator line height + padding in pixels */
const SEPARATOR_HEIGHT = 12;

/** Default footnote font size in points */
const FOOTNOTE_FONT_SIZE = 8;

// ============================================================================
// 1. Scan FlowBlocks for footnote references
// ============================================================================

/**
 * Scan FlowBlocks for runs with footnoteRefId set.
 * Returns a list of { footnoteId, pmPos } in document order.
 */
export function collectFootnoteRefs(
  blocks: FlowBlock[]
): Array<{ footnoteId: number; pmPos: number }> {
  const refs: Array<{ footnoteId: number; pmPos: number }> = [];

  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    for (const run of block.runs) {
      if (run.kind === 'text' && run.footnoteRefId != null) {
        refs.push({
          footnoteId: run.footnoteRefId,
          pmPos: run.pmStart ?? 0,
        });
      }
    }
  }

  return refs;
}

// ============================================================================
// 2. Map footnote references to pages
// ============================================================================

/**
 * After layout, determine which footnotes appear on which pages.
 * Checks each page's fragments to see if any footnoteRef PM positions fall within.
 *
 * Returns Map<pageNumber, footnoteId[]> in document order.
 */
export function mapFootnotesToPages(
  pages: Page[],
  footnoteRefs: Array<{ footnoteId: number; pmPos: number }>
): Map<number, number[]> {
  const pageFootnotes = new Map<number, number[]>();

  if (footnoteRefs.length === 0) return pageFootnotes;

  // For each footnote ref, find which page it lands on
  for (const ref of footnoteRefs) {
    for (const page of pages) {
      let found = false;
      for (const fragment of page.fragments) {
        const pmStart = fragment.pmStart ?? -1;
        const pmEnd = fragment.pmEnd ?? -1;
        if (pmStart >= 0 && pmEnd >= 0 && ref.pmPos >= pmStart && ref.pmPos < pmEnd) {
          const existing = pageFootnotes.get(page.number) ?? [];
          // Avoid duplicates (same footnote shouldn't appear twice on same page)
          if (!existing.includes(ref.footnoteId)) {
            existing.push(ref.footnoteId);
          }
          pageFootnotes.set(page.number, existing);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return pageFootnotes;
}

// ============================================================================
// 3. Convert footnote content to FlowBlocks + Measures
// ============================================================================

/**
 * Convert a Footnote's content paragraphs to FlowBlocks suitable for rendering.
 * Prepends the display number to the first run of the first paragraph.
 */
export function convertFootnoteToContent(
  footnote: Footnote,
  displayNumber: number,
  contentWidth: number
): FootnoteContent {
  const blocks: FlowBlock[] = [];

  for (let i = 0; i < footnote.content.length; i++) {
    const para = footnote.content[i];
    const runs: Run[] = [];

    // For the first paragraph, prepend the footnote number
    if (i === 0) {
      const numberRun: TextRun = {
        kind: 'text',
        text: `${displayNumber}  `,
        fontSize: FOOTNOTE_FONT_SIZE,
        superscript: true,
      };
      runs.push(numberRun);
    }

    // Convert paragraph content to runs
    for (const content of para.content) {
      const contentObj = content as unknown as Record<string, unknown>;

      if (contentObj.type === 'run' && Array.isArray(contentObj.content)) {
        const formatting = contentObj.formatting as Record<string, unknown> | undefined;
        const runFormatting: RunFormatting = {};

        if (formatting) {
          if (formatting.bold) runFormatting.bold = true;
          if (formatting.italic) runFormatting.italic = true;
          if (formatting.underline) runFormatting.underline = true;
          if (formatting.strike) runFormatting.strike = true;
          if (formatting.color) {
            const color = formatting.color as Record<string, unknown>;
            if (color.val) runFormatting.color = `#${color.val}`;
            else if (color.rgb) runFormatting.color = `#${color.rgb}`;
          }
          if (formatting.fontSize) {
            runFormatting.fontSize = (formatting.fontSize as number) / 2; // half-points to points
          }
          if (formatting.fontFamily) {
            const ff = formatting.fontFamily as Record<string, unknown>;
            runFormatting.fontFamily = (ff.ascii || ff.hAnsi) as string;
          }
        }

        // If no fontSize specified, use footnote default
        if (!runFormatting.fontSize) {
          runFormatting.fontSize = FOOTNOTE_FONT_SIZE;
        }

        for (const rc of contentObj.content as unknown[]) {
          const rcObj = rc as Record<string, unknown>;
          if (rcObj.type === 'text' && typeof rcObj.text === 'string') {
            runs.push({
              kind: 'text',
              text: rcObj.text,
              ...runFormatting,
            });
          } else if (rcObj.type === 'tab') {
            runs.push({ kind: 'tab', ...runFormatting });
          } else if (rcObj.type === 'break') {
            runs.push({ kind: 'lineBreak' });
          } else if (rcObj.type === 'footnoteRef') {
            // Self-reference marker - skip (we prepend the number ourselves)
          }
        }
      }
    }

    // If no runs were generated, add an empty text run to ensure the paragraph renders
    if (runs.length === 0) {
      runs.push({ kind: 'text', text: '', fontSize: FOOTNOTE_FONT_SIZE });
    }

    const paragraphBlock: ParagraphBlock = {
      kind: 'paragraph',
      id: `fn-${footnote.id}-p${i}`,
      runs,
    };
    blocks.push(paragraphBlock);
  }

  if (blocks.length === 0) {
    blocks.push({
      kind: 'paragraph',
      id: `fn-${footnote.id}-empty`,
      runs: [{ kind: 'text', text: '', fontSize: FOOTNOTE_FONT_SIZE }],
    });
  }

  // Measure blocks
  const measures: Measure[] = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const m = measureParagraph(block, contentWidth);
      measures.push(m);
    }
  }

  const totalHeight = measures.reduce((h, m) => {
    if (m.kind === 'paragraph') return h + m.totalHeight;
    return h;
  }, 0);

  return {
    id: footnote.id,
    displayNumber,
    blocks,
    measures,
    height: totalHeight,
  };
}

// ============================================================================
// 4. Build per-page footnote content and reserved heights
// ============================================================================

/**
 * Build footnote content for all footnotes referenced in the document.
 * Returns a Map<footnoteId, FootnoteContent>.
 */
export function buildFootnoteContentMap(
  footnotes: Footnote[],
  footnoteRefs: Array<{ footnoteId: number }>,
  contentWidth: number
): Map<number, FootnoteContent> {
  const contentMap = new Map<number, FootnoteContent>();
  const footnoteById = new Map<number, Footnote>();

  for (const fn of footnotes) {
    if (fn.noteType === 'normal' || fn.noteType == null) {
      footnoteById.set(fn.id, fn);
    }
  }

  // Assign display numbers in order of first appearance
  let displayNumber = 1;
  const seen = new Set<number>();

  for (const ref of footnoteRefs) {
    if (seen.has(ref.footnoteId)) continue;
    seen.add(ref.footnoteId);

    const footnote = footnoteById.get(ref.footnoteId);
    if (!footnote) continue;

    const content = convertFootnoteToContent(footnote, displayNumber, contentWidth);
    contentMap.set(ref.footnoteId, content);
    displayNumber++;
  }

  return contentMap;
}

/**
 * Calculate per-page footnote reserved heights.
 * Returns Map<pageNumber, reservedHeight>.
 */
export function calculateFootnoteReservedHeights(
  pageFootnoteMap: Map<number, number[]>,
  footnoteContentMap: Map<number, { height: number }>
): Map<number, number> {
  const reserved = new Map<number, number>();

  for (const [pageNumber, footnoteIds] of pageFootnoteMap) {
    let totalHeight = 0;

    for (const fnId of footnoteIds) {
      const content = footnoteContentMap.get(fnId);
      if (content) {
        totalHeight += content.height;
      }
    }

    if (totalHeight > 0) {
      // Add separator height
      totalHeight += SEPARATOR_HEIGHT;
      reserved.set(pageNumber, totalHeight);
    }
  }

  return reserved;
}
