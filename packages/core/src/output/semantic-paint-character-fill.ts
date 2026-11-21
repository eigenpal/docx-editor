// Character highlight (`w:highlight`) and shading (`w:rPr/w:shd`) on a line whose runs share one
// fill band.
//
// A run normally fills its own box, seated on the baseline. Layout publishes
// `LineRecord.characterFillBand` where the runs share one band instead: the whole box of an
// exact-spaced line, and the natural content band beside an inline drawing, which raises the
// baseline above the text's own box. The run's fill then moves to a backing behind the line's
// text, at the run's advance and the band's top and height. The run keeps its geometry, text,
// and model offsets, so selection and the caret do not change.
import type { LineRecord, StyleSpanRecord } from '../layout/semantic-records.ts';
import { HIGHLIGHT_COLOR_HEX } from './semantic-paint-highlight-colors.ts';

const HEX = /^[0-9A-Fa-f]{6}$/;

/** The fill a span's own style paints: its highlight, else its character shading. */
function characterFill(span: StyleSpanRecord): string | undefined {
  const { highlight, shading } = span.style;
  const named = highlight ? HIGHLIGHT_COLOR_HEX.get(highlight) : undefined;
  if (named) return named;
  return shading && HEX.test(shading) ? `#${shading}` : undefined;
}

/** Collects the fill backings of one painted line. */
export interface CharacterFillLayer {
  /**
   * Move the character fill of `painted` (the element painted for `span`) to the band. A fill
   * that something else replaced, such as a tracked-change wash, stays on the run.
   * `ownedGap` is the justification gap the run paints after its own advance.
   */
  add(painted: HTMLElement, span: StyleSpanRecord, ownedGap: number): void;
  /** Mount the collected backings behind the text of the line element. */
  mount(element: HTMLElement): void;
}

/** The fill layer of `line`, or null when its runs fill their own boxes. */
export function characterFillLayer(
  document: Document,
  line: LineRecord,
  scale: number
): CharacterFillLayer | null {
  const band = line.characterFillBand;
  if (!band || !(band.height > 0)) return null;
  const layer = document.createElement('span');
  // The DOM normalises colours on write, so compare through a scratch style.
  const probe = document.createElement('span').style;
  return {
    add(painted, span, ownedGap) {
      if (span.equation || !(span.box.width > 0)) return;
      const fill = characterFill(span);
      if (!fill) return;
      probe.backgroundColor = fill;
      if (painted.style.backgroundColor !== probe.backgroundColor) return;
      const backing = document.createElement('span');
      // Dark mode keeps a highlight's authored colour; shading inverts with the page.
      if (painted.dataset.highlight !== undefined)
        backing.dataset.highlight = painted.dataset.highlight;
      backing.style.position = 'absolute';
      backing.style.top = `${band.top * scale}px`;
      backing.style.left = `${(span.box.x - line.contentX) * scale}px`;
      backing.style.width = `${(span.box.width + ownedGap) * scale}px`;
      backing.style.height = `${band.height * scale}px`;
      backing.style.backgroundColor = painted.style.backgroundColor;
      painted.style.backgroundColor = '';
      layer.append(backing);
    },
    mount(element) {
      if (layer.childElementCount === 0) return;
      layer.className = 'docx-character-fill-band';
      layer.dataset.docxMarker = '';
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('contenteditable', 'false');
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '-1';
      // The layer sits behind this line's text, never behind the page.
      element.style.isolation = 'isolate';
      element.prepend(layer);
    },
  };
}
