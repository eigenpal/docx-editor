import { forEachSemanticSpan, type SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';

/** Logical text evidence, not PDF extraction or final painted geometry. */
export function recordLayoutText(layout: ExportSemanticLayout) {
  const pages = layout.pages.map(() => ({ lines: [] as Line[] }));
  const groups = layout.pages.map(() => new Map<object, Map<string, Line>>());
  let characters = 0;
  let spans = 0;
  forEachSemanticSpan(layout, (visit) => {
    const text = visit.span.equation?.fallbackText ?? visit.span.text;
    characters += text.length;
    if (++spans > 250_000 || characters > 8_000_000)
      throw new Error('Layout text exceeds evidence limit');
    const page = pages[visit.page.index]!;
    const groupsOnPage = groups[visit.page.index]!;
    let paragraphs = groupsOnPage.get(visit.line);
    if (!paragraphs) groupsOnPage.set(visit.line, (paragraphs = new Map()));
    let line = paragraphs.get(visit.paragraphId);
    if (!line) {
      const marker = visit.paragraph.lines[0] === visit.line ? visit.paragraph.marker?.text : '';
      line = {
        text: marker ? marker + ' ' : '',
        story: visit.story,
        paragraphId: visit.paragraphId,
        spans: [],
      };
      paragraphs.set(visit.paragraphId, line);
      page.lines.push(line);
    }
    line.text += text;
    line.spans.push({
      text,
      sourceRange: visit.sourceRange,
      box: {
        ...visit.absoluteBox,
        x: visit.absoluteBox.x - visit.page.box.x,
        y: visit.absoluteBox.y - visit.page.box.y,
      },
    });
  });
  return {
    version: 'layout-text-v1',
    coordinateSpace: 'page-relative-layout-points',
    geometryStatus: 'before-paint-transforms',
    pages,
  };
}

interface Line {
  text: string;
  story: SemanticSpanVisit['story'];
  paragraphId: string;
  spans: {
    text: string;
    sourceRange: SemanticSpanVisit['sourceRange'];
    box: SemanticSpanVisit['absoluteBox'];
  }[];
}
