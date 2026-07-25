// Display-only vertical ruler (interactive-paginated-editing M4.4).
// Shared adapter presentation and compatibility behavior.
// presentation for the same reason as the horizontal ruler: the legacy top and
// bottom margin drag handles have no greenfield contract to write through.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { useEditorSnapshot } from './useEditorSnapshot';
import { generateRulerTicks, rulerPageBox, type RulerUnit } from './rulerTicks';

/** Matches the legacy `RULER_WIDTH` so the shell gutter is unchanged. */
export const RULER_WIDTH = 20;

/** Matches `.docx-editor__content .ep-one-surface__viewport` padding, so the ruler's zero
 *  lines up with the top of the first page instead of floating above it. */
const PAGE_TOP_PADDING = 24;
/** Breathing room between the ruler and the page edge, as legacy. */
const PAGE_RULER_GAP = 6;

export interface VerticalRulerProps {
  readonly editor: Editor | null;
  readonly zoom?: number;
  readonly unit?: RulerUnit;
}

export function VerticalRuler({ editor, zoom = 1, unit = 'inch' }: VerticalRulerProps): ReactNode {
  useEditorSnapshot(editor);
  if (!editor) return null;
  const box = rulerPageBox(editor.getPageGeometry());
  if (!box) return null;
  const ticks = generateRulerTicks(box.height, unit);
  return (
    // Positioned against the PAGE, not the viewport gutter.
    //
    // Mounted at the content column's left edge it rendered against the window with its
    // scale running down the far edge of the screen, nowhere near the document — an
    // owner review called it out and it was removed outright. The page is centred in the
    // viewport, so anchoring at 50% and stepping back half the page plus the ruler's own
    // width puts it exactly where the legacy product has it: immediately left of the
    // page, top-aligned with it.
    <div
      className="ep-ruler ep-ruler--vertical"
      data-testid="vertical-ruler"
      role="presentation"
      aria-hidden="true"
      style={{
        width: RULER_WIDTH,
        height: box.height * zoom,
        position: 'absolute',
        top: PAGE_TOP_PADDING,
        left: '50%',
        marginLeft: -((box.width * zoom) / 2) - RULER_WIDTH - PAGE_RULER_GAP,
        // Presentation only: it must never intercept a click meant for the page.
        pointerEvents: 'none',
      }}
    >
      {ticks.map((tick) => (
        <div
          key={tick.position}
          className="ep-ruler__tick"
          style={{ top: tick.position * zoom, width: tick.height }}
        >
          {tick.label ? <span className="ep-ruler__label">{tick.label}</span> : null}
        </div>
      ))}
    </div>
  );
}
