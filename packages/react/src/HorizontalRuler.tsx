// Display-only horizontal ruler (interactive-paginated-editing M4.4).
// Shared adapter presentation and compatibility behavior.
// presentation. The legacy ruler took `SectionProperties`, `TabMark[]`, and six
// mutation callbacks and rendered draggable margin, indent, and tab markers.
// This change owns no section-geometry contract, so all of that is omitted
// rather than rendered inert — and the ruler reads page geometry from the
// public `Editor.getPageGeometry()` instead of document properties.

import type { ReactNode } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { useEditorSnapshot } from './useEditorSnapshot';
import { generateRulerTicks, rulerPageBox, type RulerUnit } from './rulerTicks';

export interface HorizontalRulerProps {
  readonly editor: Editor | null;
  readonly zoom?: number;
  readonly unit?: RulerUnit;
}

export function HorizontalRuler({ editor, zoom = 1, unit = 'inch' }: HorizontalRulerProps): ReactNode {
  useEditorSnapshot(editor);
  if (!editor) return null;
  const box = rulerPageBox(editor.getPageGeometry());
  if (!box) return null;
  const ticks = generateRulerTicks(box.width, unit);
  // Margin zones, from the page's laid-out content box (M6V.6). The legacy ruler shades
  // the margins with `--doc-shadow-subtle` and a 1px inner border; without them the ruler
  // is a bare tick strip that shows nothing about the page. A page with no known content
  // box yields no zones rather than a guessed margin.
  const page = editor.getPageGeometry()[0];
  const content = page?.contentBox;
  const leftMargin = content ? content.x : 0;
  const rightMargin = content ? box.width - (content.x + content.width) : 0;
  return (
    <div
      className="ep-ruler ep-ruler--horizontal"
      data-testid="horizontal-ruler"
      role="presentation"
      aria-hidden="true"
      style={{ width: box.width * zoom }}
    >
      {leftMargin > 0 ? (
        <div className="ep-ruler__margin ep-ruler__margin--start" style={{ width: leftMargin * zoom }} />
      ) : null}
      {rightMargin > 0 ? (
        <div className="ep-ruler__margin ep-ruler__margin--end" style={{ width: rightMargin * zoom }} />
      ) : null}
      {ticks.map((tick) => (
        <div
          key={tick.position}
          className="ep-ruler__tick"
          style={{ left: tick.position * zoom, height: tick.height }}
        >
          {tick.label ? <span className="ep-ruler__label">{tick.label}</span> : null}
        </div>
      ))}
    </div>
  );
}
