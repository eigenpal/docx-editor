// Type checks of the Vue shape and chart part API, compiled by `bun check`: typed slot values,
// `toggle` only on toggle slots, and the Vue snippets of the object controls guide
// (`docs/site/content/guides/object-controls.mdx`). The React twin is
// `packages/react/test/object-control-types.tsx`.

import { defineComponent, h, ref } from 'vue';
import type { ColorPick } from '@docx-editor.dev/core/editor';
import { DocxEditor, useObjectControl, usePaneRequest } from '../src/index';

export function typedControls(): void {
  const width = useObjectControl('shape.outlineWidth');
  const widthValue: number | null = width.value.value;
  width.execute(2.25);
  useObjectControl('chart.axes').toggle();
  // @ts-expect-error A value slot has no toggle.
  void width.toggle;
  // @ts-expect-error A legend position is not any text.
  useObjectControl('chart.legend').execute('middle');
  const fill = useObjectControl('shape.fill');
  // A colour slot reads back a grid pick or `none`, and still takes a colour name.
  const read: ColorPick | 'none' | null = fill.value.value;
  fill.execute('red');
  void widthValue;
  void read;
}

// The guide's Vue toolbar and pane request, as a render function.
export const ShapeToolbarAndPopover = defineComponent({
  setup() {
    const open = ref(false);
    usePaneRequest(() => (open.value = true), { panes: ['chart'] });
    return () => [
      h('div', { role: 'toolbar', 'aria-label': 'Shape' }, [
        h(DocxEditor.ShapeFill, { variant: 'compact' }),
        h(DocxEditor.ShapeOutlineDash, { variant: 'compact' }),
      ]),
      open.value
        ? h('div', { role: 'dialog', 'aria-label': 'Chart' }, [
            h(DocxEditor.PaneSections, { pane: 'chart', sections: ['type', 'elements'] }),
          ])
        : null,
    ];
  },
});

// The guide's Vue colour picker: the read value goes to `ColorPicker.Root` with no cast.
export const OutlineColor = defineComponent({
  setup() {
    const { value, isEnabled, label, execute } = useObjectControl('shape.outlineColor');
    return () =>
      h(
        DocxEditor.ColorPicker.Root,
        {
          value: value.value,
          disabled: !isEnabled.value,
          onPick: (pick: ColorPick | 'none') => execute(pick),
        },
        {
          default: () => [
            h(DocxEditor.ColorPicker.Trigger, { 'aria-label': label.value }),
            h(DocxEditor.ColorPicker.Content),
          ],
        }
      );
  },
});
