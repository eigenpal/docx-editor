// The authoring form: collect the attrs, then one `insertCustomNode` (or `updateCustomNode`)
// call authors the locked, tagged control at the captured caret. The form itself is entirely
// the demo's; nothing here is a library component.
//
// Attrs ride in the `w:tag`, which Word caps at 64 characters, so the fields collect one
// number and a label rather than a payload.

import { useState } from 'react';
import {
  blocksOf,
  defaultAttrs,
  depthOf,
  labelFor,
  randomSpecimen,
  type SpecimenAt,
  type SpecimenKind,
} from './specimens';

export type SpecimenForm =
  | {
      readonly mode: 'insert';
      readonly kind: SpecimenKind;
      readonly attrs: Record<string, string>;
      readonly label: string;
      readonly at: SpecimenAt;
    }
  | {
      readonly mode: 'edit';
      readonly kind: SpecimenKind;
      readonly nodeId: string;
      readonly attrs: Record<string, string>;
      readonly label: string;
    };

interface SpecimenDialogProps {
  readonly form: SpecimenForm;
  readonly onCommit: (form: SpecimenForm) => void;
  readonly onClose: () => void;
}

/** The one number each kind carries, with the words that go around it. */
const FIELD: Record<SpecimenKind, { key: string; label: string; hint: string; max: number }> = {
  iceberg: {
    key: 'depth',
    label: 'Depth below the waterline (m)',
    hint: 'A tenth of that shows above it.',
    max: 999,
  },
  igloo: { key: 'blocks', label: 'Blocks laid', hint: 'Each one is a degree kept in.', max: 999 },
};

export function SpecimenDialog({ form, onCommit, onClose }: SpecimenDialogProps) {
  const [kind, setKind] = useState<SpecimenKind>(form.kind);
  const [attrs, setAttrs] = useState<Record<string, string>>(form.attrs);
  const [label, setLabel] = useState(form.label);
  const editing = form.mode === 'edit';
  const field = FIELD[kind];
  const value = kind === 'iceberg' ? depthOf(attrs) : blocksOf(attrs);

  /** Switching kind switches which attr is meaningful, so the defaults come with it. */
  const chooseKind = (next: SpecimenKind): void => {
    if (next === kind) return;
    const fresh = defaultAttrs(next);
    setKind(next);
    setAttrs(fresh);
    setLabel(labelFor(next, fresh));
  };

  const surprise = (): void => {
    const picked = randomSpecimen();
    setKind(picked.kind);
    setAttrs(picked.attrs);
    setLabel(picked.label);
  };

  return (
    <div
      className="igloo-dialog__scrim"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Re-carve this specimen' : 'Carve a specimen'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Escape closes, like every packaged panel. Listening on the scrim is enough because
      // the autofocused field below puts focus inside it the moment the dialog opens.
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <form
        className="igloo-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onCommit(
            editing
              ? { mode: 'edit', kind, nodeId: form.nodeId, attrs, label }
              : { mode: 'insert', kind, attrs, label, at: form.at }
          );
        }}
      >
        <h2 className="igloo-dialog__title">{editing ? 'Re-carve it' : 'Carve a specimen'}</h2>
        <p className="igloo-dialog__lede">
          The label is what the paragraph shows, in this editor and in Word. The number rides
          in the control&rsquo;s tag and comes back typed on the chip, the card and the menu.
        </p>

        {/* Fixed while editing: swapping the tag would be deleting one node and authoring
            another, which the Remove row already does more honestly. */}
        <fieldset className="igloo-dialog__kinds" disabled={editing}>
          <legend className="igloo-dialog__legend">Specimen</legend>
          {(['iceberg', 'igloo'] as const).map((option) => (
            <label key={option} className="igloo-dialog__kind" data-checked={kind === option ? '' : undefined}>
              <input
                type="radio"
                name="igloo-specimen-kind"
                checked={kind === option}
                onChange={() => chooseKind(option)}
              />
              {option === 'iceberg' ? 'Iceberg' : 'Igloo'}
            </label>
          ))}
        </fieldset>

        <label className="igloo-dialog__field">
          <span>Label (document text)</span>
          {/* A modal dialog is the one place initial focus belongs inside; the scrim's
              Escape handler depends on focus landing here. */}
          <input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} required />
        </label>

        <label className="igloo-dialog__field">
          <span>{field.label}</span>
          <input
            type="number"
            min={1}
            max={field.max}
            value={value}
            onChange={(event) => setAttrs({ [field.key]: event.target.value })}
          />
          <small>{field.hint}</small>
        </label>

        <div className="igloo-dialog__actions">
          {/* The same form, filled from the water instead of by hand. */}
          <button type="button" className="igloo-dialog__ghost" onClick={surprise}>
            Surprise me
          </button>
          <span className="igloo-dialog__spacer" />
          <button type="button" className="igloo-dialog__ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="igloo-dialog__commit">
            {editing ? 'Re-carve' : 'Carve it'}
          </button>
        </div>
      </form>
    </div>
  );
}
