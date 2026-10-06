/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { observeContentControlPopup } from '@docx-editor.dev/core/editor';

/** Native radio groups keep color selection usable without pointer input. */
export function createRevisionColorPicker(
  doc: Document,
  options: {
    id: string;
    label: string;
    colors: readonly string[];
    translate(value: string): string;
    change(value: string): void;
  }
): { element: HTMLElement; update(value: string, disabled: boolean): void; destroy(): void } {
  const element = doc.createElement('div');
  element.className = 'docx-revision-color-picker';
  const label = doc.createElement('span');
  label.textContent = options.label;
  label.id = `${options.id}-label`;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'docx-revision-color-trigger';
  button.setAttribute('aria-labelledby', `${label.id} ${options.id}-value`);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `${options.id}-options`);
  const sample = doc.createElement('span');
  sample.className = 'docx-revision-color-swatch';
  sample.setAttribute('aria-hidden', 'true');
  const valueLabel = doc.createElement('span');
  valueLabel.id = `${options.id}-value`;
  button.append(sample, valueLabel);
  const list = doc.createElement('div');
  list.id = `${options.id}-options`;
  list.className = 'docx-revision-color-options';
  list.hidden = true;
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-labelledby', label.id);
  const inputs = new Map<string, HTMLInputElement>();
  const colorValue = (value: string) =>
    value === 'auto'
      ? 'currentColor'
      : value === 'byAuthor'
        ? 'var(--doc-review-author-0)'
        : value === 'none'
          ? 'transparent'
          : `var(--doc-revision-color-${value})`;
  let disposePosition: (() => void) | undefined;
  const close = () => {
    disposePosition?.();
    disposePosition = undefined;
    doc.removeEventListener('pointerdown', outside, true);
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) close();
  };
  element.addEventListener('focusout', (event) => {
    if (!element.contains(event.relatedTarget as Node | null)) close();
  });
  const choose = (value: string) => {
    options.change(value);
  };
  for (const value of options.colors) {
    const option = doc.createElement('label');
    option.className = 'docx-revision-color-option';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = options.id;
    input.value = value;
    input.addEventListener('change', () => choose(value));
    input.addEventListener('click', (event) => {
      // Arrow keys synthesize clicks when native radio selection changes.
      if (event.detail === 0) return;
      close();
      button.focus();
    });
    const swatch = doc.createElement('span');
    swatch.className = 'docx-revision-color-swatch';
    swatch.style.backgroundColor = colorValue(value);
    swatch.setAttribute('aria-hidden', 'true');
    option.append(input, swatch, doc.createTextNode(options.translate(value)));
    list.append(option);
    inputs.set(value, input);
  }
  button.addEventListener('click', () => {
    const open = list.hidden;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) {
      close();
      return;
    }
    disposePosition = observeContentControlPopup(list, button);
    doc.addEventListener('pointerdown', outside, true);
    if (open)
      (
        Array.from(inputs.values()).find((input) => input.checked) ?? inputs.values().next().value
      )?.focus();
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    }
  });
  element.append(label, button, list);
  return {
    element,
    destroy: close,
    update(value, disabled) {
      valueLabel.textContent = options.translate(value);
      sample.style.backgroundColor = colorValue(value);
      button.disabled = disabled;
      for (const [color, input] of inputs) {
        input.checked = color === value;
        input.disabled = disabled;
      }
      if (disabled) close();
    },
  };
}
