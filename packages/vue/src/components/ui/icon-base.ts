import { defineComponent, h, type CSSProperties, type PropType, type VNode } from 'vue';

/** @public */
export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const defaultSize = 20;

/** SVG wrapper for Material Symbols (viewBox 0 -960 960 960). */
export const SvgIcon = defineComponent({
  name: 'SvgIcon',
  props: {
    size: { type: Number, default: defaultSize },
    className: { type: String, default: '' },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    return () =>
      h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: props.size,
          height: props.size,
          viewBox: '0 -960 960 960',
          fill: 'currentColor',
          class: props.className,
          style: { display: 'inline-flex', flexShrink: 0, ...props.style },
          ariaHidden: 'true',
        },
        slots.default?.()
      );
  },
});

export type IconComponent = (props: IconProps) => VNode;
