// Display-only vertical ruler (interactive-paginated-editing M4.4).
// Shared adapter presentation and compatibility behavior.
// presentation for the same reason as the horizontal ruler: the legacy top and
// bottom margin drag handles have no greenfield contract to write through.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { generateRulerTicks, rulerPageBox, type RulerUnit } from './rulerTicks';

/** Matches the legacy `RULER_WIDTH` so the shell gutter is unchanged. */
export const RULER_WIDTH = 20;

export interface VerticalRulerProps {
  readonly editor: Editor | null;
  readonly zoom?: number;
  readonly unit?: RulerUnit;
}

export function VerticalRuler({ editor, zoom = 1, unit = 'inch' }: VerticalRulerProps): ReactNode {
  if (!editor) return null;
  const box = rulerPageBox(editor.getPageGeometry());
  if (!box) return null;
  const ticks = generateRulerTicks(box.height, unit);
  return (
    <div
      className="ep-ruler ep-ruler--vertical"
      data-testid="vertical-ruler"
      role="presentation"
      aria-hidden="true"
      style={{ width: RULER_WIDTH, height: box.height * zoom }}
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
