// What a chip click opens, drawn against the chip.
//
// The card names the chip it belongs to and lets CSS anchor it there — see
// `shared/useChipPopover`. Nothing here measures the document, so the card stays on its
// specimen through a scroll instead of being closed by one.

import { BergGlyph, DomeGlyph } from './art/Specimen';
import { insideTemperature, OUTSIDE, tipHeight } from './specimens';
import { useChipPopover } from '../../shared/useChipPopover';

export type SpecimenProbe =
  | {
      readonly kind: 'iceberg';
      /** The control the card hangs off. */
      readonly controlId: string | undefined;
      readonly depth: number;
      /** From the payload, so the popover shows what the tag never could. */
      readonly surveyedBy?: string;
      readonly notes?: string;
    }
  | { readonly kind: 'igloo'; readonly controlId: string | undefined; readonly blocks: number };

interface SpecimenPopoverProps {
  readonly probe: SpecimenProbe | null;
  readonly onClose: () => void;
}

export function SpecimenPopover({ probe, onClose }: SpecimenPopoverProps) {
  const { ref } = useChipPopover<HTMLDivElement>(probe?.controlId, onClose);
  return (
    // Not a dialog: nothing in it takes focus and nothing in it acts. It is a transient
    // readout the chip click revealed, so it carries no role — and its mousedown is
    // prevented, per the chrome rule: a press that reaches the surface moves the caret,
    // and reading two numbers must not do that. `useChipPopover` closes it on a press
    // anywhere that is not a chip or the card, and on Escape.
    <div
      ref={ref}
      popover="manual"
      className="igloo-probe"
      data-kind={probe?.kind}
      onMouseDown={(event) => event.preventDefault()}
    >
      {probe?.kind === 'iceberg' ? (
        <>
          <p className="igloo-probe__title">There is more of it than that</p>
          <BergGlyph className="igloo-probe__art" />
          <Stats
            rows={[
              ['Above', `${tipHeight(probe.depth)} m`],
              ['Below', `${probe.depth} m`],
              ...(probe.surveyedBy ? ([['Surveyed by', probe.surveyedBy]] as const) : []),
            ]}
          />
        </>
      ) : probe ? (
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
      ) : null}
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
