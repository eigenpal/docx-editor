import { defineComponent, h, type CSSProperties, type PropType } from 'vue';
import { SvgIcon, type IconProps } from './icon-base';

export type { IconProps };

function pathIcon(d: string) {
  return defineComponent({
    name: 'Icon',
    props: {
      size: { type: Number, default: 20 },
      className: { type: String, default: '' },
      style: { type: Object as PropType<CSSProperties>, default: undefined },
    },
    setup(props: IconProps) {
      return () => h(SvgIcon, props, () => h('path', { d }));
    },
  });
}

const IconArrowBack = pathIcon(
  'M280-200v-80h284q63 0 109.5-40T720-420q0-60-46.5-100T564-560H312l104 104-56 56-200-200 200-200 56 56-104 104h252q97 0 166.5 63T800-420q0 94-69.5 157T564-200H280Z'
);
const IconSearch = pathIcon(
  'M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z'
);
const IconClose = pathIcon(
  'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z'
);
const IconKeyboardArrowUp = pathIcon(
  'M480-560 280-360l56-56 144-144 144 144 56 56-200 200-200-200Z'
);
const IconKeyboardArrowDown = pathIcon(
  'M480-360 280-560l56-56 144 144 144-144 56 56-200 200-200-200Z'
);
const IconToc = pathIcon('M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z');

const iconMap: Record<string, ReturnType<typeof pathIcon>> = {
  arrow_back: IconArrowBack,
  search: IconSearch,
  close: IconClose,
  keyboard_arrow_up: IconKeyboardArrowUp,
  keyboard_arrow_down: IconKeyboardArrowDown,
  toc: IconToc,
};

/** MaterialSymbol-compatible component using inline SVGs. @public */
export const MaterialSymbol = defineComponent({
  name: 'MaterialSymbol',
  props: {
    name: { type: String, required: true },
    size: { type: Number, default: 20 },
    className: { type: String, default: '' },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    return () => {
      const IconComponent = iconMap[props.name];
      if (!IconComponent) {
        console.warn(`Icon not found: ${props.name}`);
        return h(
          'span',
          {
            class: props.className,
            style: { fontSize: props.size, width: props.size, height: props.size, ...props.style },
          },
          props.name
        );
      }
      return h(IconComponent, {
        size: props.size,
        className: props.className,
        style: props.style,
      });
    };
  },
});
