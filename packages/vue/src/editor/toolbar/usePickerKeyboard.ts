import { watch, type Ref } from 'vue';

/** Bind keyboard dismissal and option navigation to this mounted picker. */
export function usePickerKeyboard(rootRef: Ref<HTMLElement | null>, open: Ref<boolean>): void {
  watch(
    [rootRef, open],
    ([root, isOpen], _, onCleanup) => {
      if (!isOpen || !root) return;
      onCleanup(
        bindPickerKeyboard(root, () => {
          open.value = false;
        })
      );
    },
    { flush: 'post' }
  );
}

function bindPickerKeyboard(root: HTMLElement, close: () => void): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    // The editable size input owns its draft and step keys.
    if (target.matches('input[role="combobox"]')) return;
    const trigger = root.querySelector<HTMLElement>('[aria-haspopup]');
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      trigger?.focus();
      close();
      return;
    }
    const typing = target.matches('input, textarea, select');
    if (typing && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).filter(
      (option) => !option.matches(':disabled, [aria-disabled="true"]')
    );
    if (options.length === 0) return;
    const current = options.indexOf(target);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowDown') next = (current + 1) % options.length;
    else if (event.key === 'ArrowUp')
      next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    else return;
    event.preventDefault();
    event.stopPropagation();
    options[next]?.focus();
  };
  const focusout = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) close();
  };
  root.addEventListener('keydown', keydown);
  root.addEventListener('focusout', focusout);
  return () => {
    root.removeEventListener('keydown', keydown);
    root.removeEventListener('focusout', focusout);
  };
}
