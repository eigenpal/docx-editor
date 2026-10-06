import { observeContentControlPopup } from '@docx-editor.dev/core/editor';
import { useId, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const revisionColor = (value: string) =>
  value === 'auto'
    ? 'currentColor'
    : value === 'byAuthor'
      ? 'var(--doc-review-author-0)'
      : value === 'none'
        ? 'transparent'
        : `var(--doc-revision-color-${value})`;

export function RevisionMarkupColorPicker({
  label,
  value,
  values,
  disabled,
  change,
  t,
}: {
  label: string;
  value: string;
  values: readonly string[];
  disabled?: boolean;
  change(value: string): void;
  t(key: string): string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !group.current || !trigger.current) return;
    const dispose = observeContentControlPopup(group.current, trigger.current);
    group.current.querySelector<HTMLInputElement>('input:checked')?.focus();
    return dispose;
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
    if (!open) return;
    const doc = element.current?.ownerDocument;
    const outside = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) setOpen(false);
    };
    doc?.addEventListener('pointerdown', outside);
    return () => doc?.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      ref={element}
      className="docx-revision-color-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className="docx-revision-color-trigger"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open && !disabled}
        aria-controls={`${id}-options`}
        onClick={() => setOpen(!open)}
      >
        <span
          className="docx-revision-color-swatch"
          aria-hidden="true"
          style={{ backgroundColor: revisionColor(value) }}
        />
        <span id={`${id}-value`}>{t(`values.${value}`)}</span>
      </button>
      <div
        ref={group}
        id={`${id}-options`}
        className="docx-revision-color-options"
        hidden={!open || disabled}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        {values.map((color) => (
          <label key={color} className="docx-revision-color-option">
            <input
              type="radio"
              name={id}
              value={color}
              checked={value === color}
              disabled={disabled}
              onChange={() => change(color)}
              onClick={(event) => {
                if (event.detail > 0) close();
              }}
            />
            <span
              className="docx-revision-color-swatch"
              aria-hidden="true"
              style={{ backgroundColor: revisionColor(color) }}
            />
            {t(`values.${color}`)}
          </label>
        ))}
      </div>
    </div>
  );
}
