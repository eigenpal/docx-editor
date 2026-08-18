import { defineComponent, h } from 'vue';
import { useTranslation } from '../../i18n';

/** @public */
export interface PageIndicatorProps {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}

/** @public */
export const PageIndicator = defineComponent({
  name: 'PageIndicator',
  props: {
    currentPage: { type: Number, required: true },
    totalPages: { type: Number, required: true },
    visible: { type: Boolean, required: true },
  },
  setup(props) {
    const { t } = useTranslation();
    return () =>
      h(
        'div',
        {
          style: {
            position: 'absolute',
            right: '24px',
            top: '50%',
            transform: 'translateY(-50%)',
            backgroundColor: 'var(--doc-overlay)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1000,
            opacity: props.visible ? 1 : 0,
            transition: 'opacity 0.3s ease',
            userSelect: 'none',
          },
          'aria-live': 'polite',
          role: 'status',
        },
        t.value('viewer.pageIndicator', { current: props.currentPage, total: props.totalPages })
      );
  },
});
