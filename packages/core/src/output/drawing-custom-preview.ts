import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { failedGroupPictureCount } from '../layout/drawing-group-picture-layers.ts';
import { selectedDrawingGraphicKind } from '../store/package/drawing-graphic-kind.ts';
import {
  drawingSourceIssues,
  drawingSupport,
  supportIssue,
} from '../store/package/drawing-support-issues.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { clearUnsupportedElement, markUnsupportedElement } from './unsupported-elements.ts';

/** Offer a drawing that renders without some features to a host component, without changing layout. */
export function customDrawingPreview(
  element: HTMLElement,
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  enabled: boolean,
  source: OoxmlElement | null
): void {
  if (!enabled && !element.hasAttribute('data-docx-unsupported')) return;
  const previous = element.querySelector<HTMLElement>(':scope > .docx-drawing-native');
  if (previous) {
    clearUnsupportedElement(element);
    const native = element.ownerDocument.createDocumentFragment();
    while (previous.firstChild) native.append(previous.firstChild);
    element.replaceChildren(native);
  }
  if (!enabled) return;
  // Text-box stories keep their caret and selection behavior. Their drawings remain inspectable.
  if (drawing.textboxStory || drawing.groupTextboxStories || !source) return;
  if (element.querySelector('[data-docx-unsupported]')) return;
  const issues = [
    ...drawingSourceIssues(source, drawing.drawingNodeId),
    // A group that paints without some members renders, but not as authored. A picture whose
    // image cannot paint is such a member.
    ...(drawing.groupMembersNotShown || failedGroupPictureCount(drawing) > 0
      ? [
          Object.freeze({
            ...supportIssue(source, 'projection-diagnostic', 'group-member-not-shown'),
            nodeId: drawing.drawingNodeId,
          }),
        ]
      : []),
  ];
  const support = drawingSupport(
    drawing.chart?.shownAs === 'fallback' ? 'fallback' : 'rendered',
    issues
  );
  // A fully supported drawing has no gap to fill.
  if (support !== 'partial') return;
  const fallback = element.ownerDocument.createElement('div');
  fallback.className = 'docx-drawing-native';
  fallback.style.width = '100%';
  fallback.style.height = '100%';
  while (element.firstChild) fallback.append(element.firstChild);
  element.append(fallback);
  markUnsupportedElement(
    element,
    fallback,
    {
      ownerPartName: drawing.ownerPartName,
      nodeId: drawing.drawingNodeId,
      namespaceUri: source.namespaceUri,
      localName: source.localName,
      source,
      placement: 'inline',
      bounds: drawing.paintBounds,
      label: drawing.accessibility.label ?? '',
      drawing,
      drawingIssues: issues,
      support,
      graphicKind: selectedDrawingGraphicKind(source, drawing.drawingNodeId),
    },
    element
  );
}
