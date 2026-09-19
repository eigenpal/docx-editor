import { runBorderStrokesForLine } from '../layout/run-border-strokes.ts';
import type { LineRecord } from '../layout/semantic-records.ts';
import { applyParagraphBorderStyle } from './border-stroke-paint.ts';

/** Paint the engine's character-border bands without changing text advances. */
export function paintRunBorders(
  document: Document,
  host: HTMLElement,
  line: LineRecord,
  scale: number
): void {
  for (const { box, edge, side } of runBorderStrokesForLine(line)) {
    const rule = document.createElement('span');
    rule.className = `docx-run-border docx-run-border-${side}`;
    rule.dataset.docxMarker = '';
    rule.setAttribute('aria-hidden', 'true');
    rule.setAttribute('contenteditable', 'false');
    Object.assign(rule.style, {
      position: 'absolute',
      pointerEvents: 'none',
      left: `${(box.x - line.contentX) * scale}px`,
      top: `${(box.y - line.box.y) * scale}px`,
      width: `${box.width * scale}px`,
      height: `${box.height * scale}px`,
      backgroundColor: `#${edge.color ?? '000000'}`,
    });
    const vertical = side === 'left' || side === 'right';
    applyParagraphBorderStyle(
      rule,
      edge.val,
      edge.color ?? '000000',
      vertical,
      (vertical ? box.width : box.height) * scale,
      scale
    );
    host.append(rule);
  }
}
