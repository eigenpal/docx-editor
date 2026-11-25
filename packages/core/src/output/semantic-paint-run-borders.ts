import { runBorderStrokesForLine } from '../layout/run-border-strokes.ts';
import type { LineRecord } from '../layout/semantic-records.ts';
import { applyParagraphBorderStyle, isCompoundParagraphBorder } from './border-stroke-paint.ts';

/** Six hex digits, either case; anything else is not a colour this paints. */
const HEX = /^[0-9A-Fa-f]{6}$/;

/** Paint the engine's character-border bands; layout reserved their room on the line. */
export function paintRunBorders(
  document: Document,
  host: HTMLElement,
  line: LineRecord,
  scale: number
): void {
  for (const { box, edge, side } of runBorderStrokesForLine(line)) {
    // Six hex digits or black, as the paragraph and page border painters do. The colour is
    // file-supplied and lands in inline CSS, so anything else must not reach the sink.
    const color = edge.color && HEX.test(edge.color) ? edge.color : '000000';
    const rule = document.createElement('span');
    rule.className = `docx-run-border docx-run-border-${side}`;
    rule.dataset.docxMarker = '';
    rule.setAttribute('aria-hidden', 'true');
    rule.setAttribute('contenteditable', 'false');
    // Keep layout geometry, but give a very thin single rule one CSS pixel, as the paragraph
    // border painter does: a 1/2pt rule is 0.67px at 96dpi, and the browser's pixel snapping
    // drops it at some positions. The right and bottom rules grow inward, so the outline keeps
    // its outer edge and stays inside the clip of a text box. Compound styles keep the band
    // layout published.
    const vertical = side === 'left' || side === 'right';
    const published = (vertical ? box.width : box.height) * scale;
    const painted = isCompoundParagraphBorder(edge.val) ? published : Math.max(1, published);
    const grown = painted - published;
    Object.assign(rule.style, {
      position: 'absolute',
      pointerEvents: 'none',
      left: `${(box.x - line.contentX) * scale - (side === 'right' ? grown : 0)}px`,
      top: `${(box.y - line.box.y) * scale - (side === 'bottom' ? grown : 0)}px`,
      width: `${vertical ? painted : box.width * scale}px`,
      height: `${vertical ? box.height * scale : painted}px`,
      backgroundColor: `#${color}`,
    });
    applyParagraphBorderStyle(rule, edge.val, color, vertical, painted, scale);
    host.append(rule);
  }
}
