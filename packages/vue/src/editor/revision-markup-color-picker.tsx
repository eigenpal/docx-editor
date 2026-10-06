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
                list.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
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
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          onKeydown={(event) => {
            if (event.key === 'Escape' || event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          {p.colors.map((value) => (
            <label key={value} class="docx-revision-color-option">
              <input
                type="radio"
                name={id}
                value={value}
                checked={p.value === value}
                disabled={p.disabled}
                onChange={() => p.onChange(value)}
                onClick={(event) => {
                  if (event.detail > 0) close();
                }}
              />
              <span
                aria-hidden="true"
                class="docx-revision-color-swatch"
                style={{ backgroundColor: revisionColorToken(value) }}
              />
              {p.translate(value)}
            </label>
          ))}
        </div>
      </div>
    );
  },
});
