/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { observeContentControlPopup } from '@docx-editor.dev/core/editor';

/** Compact swatches share the toolbar palette appearance and keyboard controls. */
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
  list.setAttribute('role', 'group');
  list.setAttribute('aria-labelledby', label.id);
  const choices = new Map<string, HTMLButtonElement>();
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
  const special = doc.createElement('div');
  special.className = 'docx-revision-color-special';
  const grid = doc.createElement('div');
  grid.className = 'docx-toolbar__swatch-grid';
  list.append(special, grid);
  for (const value of options.colors) {
    const option = doc.createElement('button');
    option.type = 'button';
    option.dataset.value = value;
    option.setAttribute('aria-label', options.translate(value));
    option.title = options.translate(value);
    if (['auto', 'none', 'byAuthor'].includes(value)) {
      option.className = 'docx-toolbar__swatch-clear';
      const swatch = doc.createElement('span');
      swatch.className = 'docx-revision-color-swatch';
      swatch.style.backgroundColor = colorValue(value);
      swatch.setAttribute('aria-hidden', 'true');
      option.append(swatch, doc.createTextNode(options.translate(value)));
      special.append(option);
    } else {
      option.className = 'docx-toolbar__swatch';
      option.dataset.light = '';
      option.style.backgroundColor = colorValue(value);
      grid.append(option);
    }
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
      options.change(value);
      close();
      button.focus();
    });
    choices.set(value, option);
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
    (
      Array.from(choices.values()).find((choice) => choice.hasAttribute('data-selected')) ??
      choices.values().next().value
    )?.focus();
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    }
    const buttons = Array.from(list.querySelectorAll('button'));
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : ['ArrowRight', 'ArrowDown'].includes(event.key)
            ? (current + 1) % buttons.length
            : ['ArrowLeft', 'ArrowUp'].includes(event.key)
              ? (current - 1 + buttons.length) % buttons.length
              : null;
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      buttons[next]?.focus();
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
      for (const [color, choice] of choices) {
        choice.setAttribute('aria-pressed', String(color === value));
        choice.toggleAttribute('data-selected', color === value);
        choice.disabled = disabled;
      }
      if (disabled) close();
    },
  };
}
