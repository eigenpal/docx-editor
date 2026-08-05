// What a chip click opens, drawn over the chip.
//
// `ActivatedCustomNode.rect` is the painted boundary's viewport rect — hence `position:
// fixed`. Re-measuring the DOM to find it again would be a repaint behind the document.

import { useEffect } from 'react';
import { BergGlyph, DomeGlyph } from './art/Specimen';
import { insideTemperature, OUTSIDE, tipHeight } from './specimens';

export type SpecimenProbe =
  | { readonly kind: 'iceberg'; readonly rect: DOMRect; readonly depth: number }
  | { readonly kind: 'igloo'; readonly rect: DOMRect; readonly blocks: number };

interface SpecimenPopoverProps {
  readonly probe: SpecimenProbe;
  readonly onClose: () => void;
}

/** Roughly the card's own height, so the fits-below test is not a guess. */
const PROBE_HEIGHT = 210;
const PROBE_WIDTH = 260;

export function SpecimenPopover({ probe, onClose }: SpecimenPopoverProps) {
  // Capture phase: the painted surface cancels its own pointer handling, so a bubbling
  // listener never hears a press on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.igloo-probe')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const above = probe.rect.bottom + PROBE_HEIGHT > window.innerHeight;
  const style = {
    left: Math.max(8, Math.min(probe.rect.left, window.innerWidth - PROBE_WIDTH - 8)),
    top: above ? probe.rect.top - 8 : probe.rect.bottom + 8,
    ...(above ? { transform: 'translateY(-100%)' } : {}),
  };

  return (
    <div className="igloo-probe" style={style} data-kind={probe.kind} role="dialog" aria-modal="false">
      {probe.kind === 'iceberg' ? (
        <>
          <p className="igloo-probe__title">There is more of it than that</p>
          <BergGlyph className="igloo-probe__art" />
          <Stats
            rows={[
              ['Above', `${tipHeight(probe.depth)} m`],
              ['Below', `${probe.depth} m`],
            ]}
          />
        </>
      ) : (
        <>
          <p className="igloo-probe__title">Block {probe.blocks} laid</p>
          <DomeGlyph className="igloo-probe__art" />
          <Stats
            rows={[
              ['Inside', `${insideTemperature(probe.blocks)} °C`],
              ['Outside', `${OUTSIDE} °C`],
            ]}
          />
        </>
      )}
    </div>
  );
}

/** The two-number readout both specimens end on. */
export function Stats({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="igloo-stats">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
