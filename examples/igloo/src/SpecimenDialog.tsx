// The authoring form: collect the attrs, then one `insertCustomNode` (or `updateCustomNode`)
// call authors the locked, tagged control at the captured caret. The form itself is entirely
// the demo's; nothing here is a library component.
//
// The form collects one bag of fields; where each one ENDS UP differs by kind. The igloo's
// number rides in the `w:tag`, which is all a small integer needs. The berg's depth, surveyor
// and notes go into a payload — a customXml data part the chip binds to — because 64 characters
// of tag was never going to hold a survey record. `payloadFor` and `tagAttrsFor` make the split.

import { useEffect, useId, useRef, useState } from 'react';
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
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleId = useId();

  // Escape and Tab containment on `document`, not the scrim: a click on the dialog's own
  // non-focusable text moves focus to `body`, and a scrim-scoped keydown would never hear
  // the Escape that follows. Tab wraps at the edges — the scrim only blocks the POINTER,
  // and `aria-modal` promises assistive tech the background is not there, so the keyboard
  // must not walk out into it. Capture phase, so the editor's keymap never sees these keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = formRef.current;
      if (!root) return;
      // `:disabled` also matches inputs inside the editing mode's disabled fieldset.
      const focusable = [...root.querySelectorAll<HTMLElement>('input, button')].filter(
        (element) => !element.matches(':disabled')
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

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
    // The scrim is presentation: it blocks the pointer and closes on a backdrop press.
    // The dialog ROLE lives on the box itself, named by its own heading, so the
    // accessibility tree matches what a sighted user sees as "the dialog".
    <div
      className="igloo-dialog__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={formRef}
        className="igloo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          // The field keeps whatever was typed, including a mid-edit empty string; the
          // COMMIT is where it clamps back into range, through the same reads the
          // recognition boundary uses.
          const clamped = {
            ...attrs,
            [field.key]: String(kind === 'iceberg' ? depthOf(attrs) : blocksOf(attrs)),
          };
          onCommit(
            editing
              ? { mode: 'edit', kind, nodeId: form.nodeId, attrs: clamped, label }
              : { mode: 'insert', kind, attrs: clamped, label, at: form.at }
          );
        }}
      >
        <h2 className="igloo-dialog__title" id={titleId}>
          {editing ? 'Re-carve it' : 'Carve a specimen'}
        </h2>
        <p className="igloo-dialog__lede">
          The label is what the paragraph shows, in this editor and in Word. The igloo&rsquo;s
          number rides in the control&rsquo;s tag; the berg&rsquo;s depth rides in a payload
          beside it, and both come back typed on the chip, the card and the menu.
        </p>

        {/* Fixed while editing: swapping the tag would be deleting one node and authoring
            another, which the Remove row already does more honestly. */}
        <fieldset className="igloo-dialog__kinds" disabled={editing}>
          <legend className="igloo-dialog__legend">Specimen</legend>
          {(['iceberg', 'igloo'] as const).map((option) => (
            <label
              key={option}
              className="igloo-dialog__kind"
              data-checked={kind === option ? '' : undefined}
            >
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
          <input
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
          />
        </label>

        <label className="igloo-dialog__field">
          <span>{field.label}</span>
          {/* The RAW string, not the clamped read: clamping while someone is still typing
              turns backspace-to-clear into an instant "90", and the only way to enter a
              number becomes select-all-overtype. Submit clamps; see onSubmit. */}
          <input
            type="number"
            min={1}
            max={field.max}
            required
            value={attrs[field.key] ?? ''}
            onChange={(event) => setAttrs({ ...attrs, [field.key]: event.target.value })}
          />
          <small>{field.hint}</small>
        </label>

        {/* The berg's survey record. Neither of these could ride in a `w:tag`, which is the
            whole reason the payload exists — so they only show for the kind that has one. */}
        {kind === 'iceberg' ? (
          <>
            <label className="igloo-dialog__field">
              <span>Surveyed by</span>
              <input
                value={attrs['surveyedBy'] ?? ''}
                onChange={(event) => setAttrs({ ...attrs, surveyedBy: event.target.value })}
              />
            </label>
            <label className="igloo-dialog__field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={attrs['notes'] ?? ''}
                onChange={(event) => setAttrs({ ...attrs, notes: event.target.value })}
              />
              <small>Free text. Kept in the payload, never in the tag.</small>
            </label>
          </>
        ) : null}

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
