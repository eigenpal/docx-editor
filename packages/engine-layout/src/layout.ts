// Deterministic body layout (document-engine section 8 core / design D7). Reads
// the authored model and a metrics port, breaks paragraphs into lines by advance
// width, paginates by height, and emits an anchored DisplayItem[]. All arithmetic
// is integer/fixed-point, so the same model + ports + config produce byte-identical
// pages in browser, worker, and server (the cross-runtime comparator, gate 9).

import { bodyStoryId, type PackageModel, type ParagraphRecord } from '@docx-editor.dev/engine-core';
import type { MetricsPort } from './metrics.ts';
import type { DisplayItem, Page, LayoutResult, TextItem } from './display-item.ts';

export interface LayoutOptions {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margin: number;
  readonly metrics: MetricsPort;
}

class PageBuilder {
  private readonly pages: Page[] = [];
  private items: DisplayItem[] = [];
  private pageIndex = 0;

  constructor(private readonly width: number, private readonly height: number) {}

  push(item: DisplayItem): void {
    this.items.push(item);
  }

  break(): void {
    this.pages.push({ index: this.pageIndex, width: this.width, height: this.height, items: this.items });
    this.items = [];
    this.pageIndex += 1;
  }

  finish(): Page[] {
    this.break();
    return this.pages;
  }
}

export function layoutBody(model: PackageModel, opts: LayoutOptions): LayoutResult {
  const { pageWidth, pageHeight, margin, metrics } = opts;
  const contentRight = pageWidth - margin;
  const contentBottom = pageHeight - margin;
  const builder = new PageBuilder(pageWidth, pageHeight);

  let x = margin;
  let y = margin;

  const newLine = (): void => {
    y += metrics.lineHeight;
    x = margin;
    if (y + metrics.lineHeight > contentBottom) {
      builder.break();
      y = margin;
    }
  };

  const story = model.stories.get(bodyStoryId(model))!;
  for (const block of story.blocks) {
    const p = block as ParagraphRecord;
    let offset = 0;
    for (const run of p.runs) {
      const bold = run.props?.bold === true;
      const italic = run.props?.italic === true;
      // Split into words and whitespace groups, preserving offsets.
      const parts = run.text.split(/(\s+)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          x += metrics.spaceWidth * part.length;
          offset += part.length;
          continue;
        }
        let wordWidth = 0;
        for (const ch of part) wordWidth += metrics.advance(ch, bold, italic);
        if (x + wordWidth > contentRight && x > margin) newLine();
        const item: TextItem = {
          type: 'text',
          x,
          y,
          width: wordWidth,
          height: metrics.lineHeight,
          text: part,
          bold,
          italic,
          anchor: { paragraphId: p.id, offset },
        };
        builder.push(item);
        x += wordWidth;
        offset += part.length;
      }
    }
    newLine(); // paragraph break
  }

  return { pages: builder.finish(), status: 'converged' };
}

/**
 * Hit-test a point against a page's display items (design D7). Returns the anchor
 * under the point, refined to a character offset within the item by advance. The
 * same inverse the DOM/PDF backends use — geometry is never re-derived.
 */
export function hitTest(result: LayoutResult, pageIndex: number, px: number, py: number, metrics: MetricsPort): TextItem['anchor'] | undefined {
  const page = result.pages[pageIndex];
  if (!page) return undefined;
  for (const item of page.items) {
    if (item.type !== 'text') continue;
    if (px >= item.x && px < item.x + item.width && py >= item.y && py < item.y + item.height) {
      // Refine to a character offset within the run by cumulative advance.
      let cursor = item.x;
      let i = 0;
      for (const ch of item.text) {
        const w = metrics.advance(ch, item.bold, item.italic);
        if (px < cursor + w / 2) break;
        cursor += w;
        i += 1;
      }
      return { paragraphId: item.anchor.paragraphId, offset: item.anchor.offset + i };
    }
  }
  return undefined;
}
