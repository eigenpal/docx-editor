// List markers of paragraphs that have no text span.
//
// The painter draws a paragraph's marker together with its first painted span. An empty
// numbered paragraph has no span, but its marker still shows, so it gets one zero-width
// visit at the marker's place that carries the marker and paints no text of its own.

import {
  forEachSemanticStory,
  forEachStoryParagraphFragment,
  type ParagraphFragmentRecord,
  type SemanticSpanVisit,
} from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';

/**
 * `spans` with one more visit for each marker whose paragraph fragment has none, placed after
 * the spans of the fragment before it so the marker keeps its reading order.
 */
export function withMarkerOnlyVisits(
  layout: ExportSemanticLayout,
  spans: readonly SemanticSpanVisit[]
): SemanticSpanVisit[] {
  // The index after each painted fragment's last span.
  const after = new Map<ParagraphFragmentRecord, number>();
  spans.forEach((visit, index) => after.set(visit.paragraph, index + 1));
  const inserts: { at: number; visit: SemanticSpanVisit }[] = [];
  let at = 0;
  forEachSemanticStory(layout, (root) => {
    if (root.story === 'note-separator') return;
    forEachStoryParagraphFragment(
      root.host,
      (fragment, context) => {
        const end = after.get(fragment);
        if (end !== undefined) {
          at = Math.max(at, end);
          return;
        }
        const marker = fragment.marker;
        const line = fragment.lines[0];
        if (!marker || !line) return;
        // A text box anchored in a header or footer takes its origin from the furniture
        // placement, which this walk does not resolve; its marker stays unpainted.
        if (context.textboxDepth > 0 && (root.story === 'header' || root.story === 'footer'))
          return;
        const box = { x: marker.box.x + marker.box.width, y: marker.box.y, width: 0, height: 0 };
        inserts.push({
          at,
          visit: {
            page: root.page,
            story: context.textboxDepth === 0 ? root.story : 'textbox',
            rootStory: root.story,
            root,
            storyOrigin: context.storyOrigin,
            absoluteBox: {
              x: context.storyOrigin.x + box.x,
              y: context.storyOrigin.y + box.y,
              width: 0,
              height: 0,
            },
            noteScopeId: root.noteScopeId,
            noteAreaKind: root.noteAreaKind,
            textboxDepth: context.textboxDepth,
            textboxOwner: context.textboxOwner,
            textboxPath: context.textboxPath,
            paragraph: fragment,
            paragraphId: fragment.paragraphId,
            line,
            span: {
              range: { paragraphId: fragment.paragraphId, start: 0, end: 0 },
              text: '',
              props: [],
              // The marker's face, without a fill: the visit paints no band of its own.
              style: { ...marker.style, highlight: undefined, shading: undefined },
              box,
              projected: true,
            },
            sourceRange: null,
          },
        });
      },
      root.origin
    );
  });
  if (inserts.length === 0) return spans as SemanticSpanVisit[];
  const merged: SemanticSpanVisit[] = [];
  let next = 0;
  spans.forEach((visit, index) => {
    while (next < inserts.length && inserts[next]!.at <= index) merged.push(inserts[next++]!.visit);
    merged.push(visit);
  });
  while (next < inserts.length) merged.push(inserts[next++]!.visit);
  return merged;
}
