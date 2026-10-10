import { defineComponent, h, type PropType } from 'vue';
import { DocxEditorMenu } from '../editor/menu';

/** @public @deprecated Use `<DocxEditor>` title slots instead. */
export const TitleBar = defineComponent({
  name: 'TitleBar',
  setup(_, { slots }) {
    return () => h('div', { class: 'docx-title-bar' }, slots.default?.());
  },
});

/** @public @deprecated Use `<DocxEditor.Menu>` instead. */
export const MenuBar = DocxEditorMenu;

/** @public @deprecated Use `<DocxEditor>` title props instead. */
export const DocumentName = defineComponent({
  name: 'DocumentName',
  props: {
    value: { type: String, default: '' },
    onChange: { type: Function as PropType<(value: string) => void>, default: undefined },
  },
  setup(props) {
    return () =>
      h('input', {
        class: 'docx-document-name',
        value: props.value,
        onInput: (event: Event) => props.onChange?.((event.target as HTMLInputElement).value),
      });
  },
});

/** @public @deprecated Use `<DocxEditor>` title slots instead. */
export const Logo = defineComponent({
  name: 'Logo',
  setup(_, { slots }) {
    return () => h('div', { class: 'docx-logo' }, slots.default?.());
  },
});

/** @public @deprecated Use `<DocxEditor>` title slots instead. */
export const TitleBarRight = defineComponent({
  name: 'TitleBarRight',
  setup(_, { slots }) {
    return () => h('div', { class: 'docx-title-bar-right' }, slots.default?.());
  },
});
