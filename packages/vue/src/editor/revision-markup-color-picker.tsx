import { ToolbarColorSwatch } from './toolbar/ColorSplit';
import { observeContentControlPopup } from '@docx-editor.dev/core/editor';
import { defineComponent, getCurrentInstance, nextTick, ref, watch, type PropType } from 'vue';

export function revisionColorToken(value: string): string {
  return value === 'auto'
    ? 'currentColor'
    : value === 'byAuthor'
      ? 'var(--doc-review-author-0)'
      : value === 'none'
        ? 'transparent'
        : `var(--doc-revision-color-${value})`;
}

export const RevisionMarkupColorPicker = defineComponent({
  name: 'RevisionMarkupColorPicker',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    colors: { type: Array as PropType<readonly string[]>, required: true },
    disabled: Boolean,
    translate: { type: Function as PropType<(value: string) => string>, required: true },
    onChange: { type: Function as PropType<(value: string) => void>, required: true },
  },
  setup(p) {
    const id = `docx-revision-color-${getCurrentInstance()!.uid}`;
    const open = ref(false);
    const root = ref<HTMLDivElement>();
    const button = ref<HTMLButtonElement>();
    const list = ref<HTMLDivElement>();
    const close = () => {
      open.value = false;
      button.value?.focus();
    };
    watch(
      () => p.disabled,
      (disabled) => {
        if (disabled) open.value = false;
      }
    );
    watch(open, (visible, _old, cleanup) => {
      if (!visible) return;
      const doc = root.value?.ownerDocument;
      const outside = (event: Event) => {
        if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
      };
      doc?.addEventListener('pointerdown', outside, true);
      doc?.addEventListener('mousedown', outside, true);
      cleanup(() => {
        doc?.removeEventListener('pointerdown', outside, true);
        doc?.removeEventListener('mousedown', outside, true);
      });
    });
    watch(
      open,
      (visible, _old, cleanup) => {
        if (visible && list.value && button.value)
          cleanup(observeContentControlPopup(list.value, button.value));
      },
      { flush: 'post' }
    );
    return () => (
      <div
        ref={root}
        class="docx-revision-color-picker"
        onFocusout={(event) => {
          if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget))
            open.value = false;
        }}
      >
        <span id={`${id}-label`}>{p.label}</span>
        <button
          ref={button}
          type="button"
          class="docx-revision-color-trigger"
          disabled={p.disabled}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-expanded={open.value}
          aria-controls={`${id}-options`}
          onClick={() => {
            open.value = !open.value;
            if (open.value)
              void nextTick(() =>
                (
                  list.value?.querySelector<HTMLButtonElement>('[data-selected]') ??
                  list.value?.querySelector<HTMLButtonElement>('button')
                )?.focus()
              );
          }}
        >
          <span
            aria-hidden="true"
            class="docx-revision-color-swatch"
            style={{ backgroundColor: revisionColorToken(p.value) }}
          />
          <span id={`${id}-value`}>{p.translate(p.value)}</span>
        </button>
        <div
          ref={list}
          id={`${id}-options`}
          class="docx-revision-color-options"
          hidden={!open.value}
          role="group"
          aria-labelledby={`${id}-label`}
          onKeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            const buttons = Array.from(
              list.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
            );
            if (!buttons.length) return;
            const current = buttons.indexOf(event.target as HTMLButtonElement);
            let next: number;
            if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = buttons.length - 1;
            else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
              next = (current + 1) % buttons.length;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
              next = (current - 1 + buttons.length) % buttons.length;
            else return;
            event.preventDefault();
            event.stopPropagation();
            buttons[next]?.focus();
          }}
        >
          <div class="docx-revision-color-special">
            {p.colors
              .filter((value) => ['byAuthor', 'auto', 'none'].includes(value))
              .map((value) => (
                <button
                  key={value}
                  type="button"
                  class="docx-toolbar__swatch-clear"
                  disabled={p.disabled}
                  data-value={value}
                  {...(p.value === value ? { 'data-selected': '' } : {})}
                  aria-pressed={p.value === value}
                  onClick={() => {
                    p.onChange(value);
                    close();
                  }}
                >
                  {p.translate(value)}
                </button>
              ))}
          </div>
          <div class="docx-toolbar__swatch-grid">
            {p.colors
              .filter((value) => !['byAuthor', 'auto', 'none'].includes(value))
              .map((value) => (
                <ToolbarColorSwatch
                  key={value}
                  value={value}
                  css={revisionColorToken(value)}
                  title={p.translate(value)}
                  selected={p.value === value}
                  disabled={p.disabled}
                  apply={(selected) => {
                    p.onChange(selected);
                    close();
                  }}
                />
              ))}
          </div>
        </div>
      </div>
    );
  },
});
