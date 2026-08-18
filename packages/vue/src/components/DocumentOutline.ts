import { defineComponent, h, onMounted, ref, type PropType } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from './ui/Icons';
import { useTranslation } from '../i18n';

/** @public */
export type OutlineHeading = ReturnType<Editor['getOutline']>[number];

export const OUTLINE_LEFT_OFFSET = 12;
const OUTLINE_WIDTH = 240;
const OUTLINE_PAGE_GAP = 16;
const OUTLINE_TOP_PADDING = 24;
export const OUTLINE_RESERVED_SPACE = OUTLINE_LEFT_OFFSET + OUTLINE_WIDTH + OUTLINE_PAGE_GAP;

export const OUTLINE_BUTTON_LEFT_OFFSET = 12;
const OUTLINE_BUTTON_BOX = 36;
export const OUTLINE_BUTTON_RESERVED_SPACE =
  OUTLINE_BUTTON_LEFT_OFFSET + OUTLINE_BUTTON_BOX + OUTLINE_PAGE_GAP;

/** @public */
export const DocumentOutline = defineComponent({
  name: 'DocumentOutline',
  props: {
    headings: { type: Array as PropType<readonly OutlineHeading[]>, required: true },
    onHeadingClick: { type: Function as PropType<(blockId: string) => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    topOffset: { type: Number, default: 0 },
    scrollLeft: { type: Number, default: 0 },
    leftOffset: { type: Number, default: OUTLINE_LEFT_OFFSET },
  },
  setup(props) {
    const { t } = useTranslation();
    const open = ref(false);

    onMounted(() => {
      requestAnimationFrame(() => {
        open.value = true;
      });
    });

    return () => {
      const minLevel = props.headings.length
        ? Math.min(...props.headings.map((heading) => heading.level))
        : 0;

      return h(
        'nav',
        {
          class: 'docx-outline-nav',
          role: 'navigation',
          'aria-label': t('documentOutline.ariaLabel'),
          style: {
            position: 'absolute',
            top: `${props.topOffset}px`,
            left: `${props.leftOffset - props.scrollLeft}px`,
            bottom: 0,
            width: `${OUTLINE_WIDTH}px`,
            paddingTop: `${OUTLINE_TOP_PADDING}px`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
            zIndex: 40,
            transform: open.value
              ? 'translateX(0)'
              : `translateX(-${props.leftOffset + OUTLINE_WIDTH}px)`,
            transition: 'transform 0.15s ease-out',
          },
          onMousedown: (event: MouseEvent) => event.stopPropagation(),
        },
        [
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '16px 16px 12px 0',
              },
            },
            [
              h(
                'button',
                {
                  onClick: props.onClose,
                  'aria-label': t('documentOutline.closeAriaLabel'),
                  title: t('documentOutline.closeTitle'),
                  style: {
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--doc-text-muted)',
                  },
                },
                [h(MaterialSymbol, { name: 'arrow_back', size: 20 })]
              ),
              h(
                'span',
                {
                  style: {
                    fontWeight: 400,
                    fontSize: 14,
                    color: 'var(--doc-text)',
                    letterSpacing: '0.01em',
                  },
                },
                t('documentOutline.title')
              ),
            ]
          ),
          h(
            'div',
            { style: { overflowY: 'auto', flex: 1, paddingLeft: '4px' } },
            props.headings.length === 0
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 16px',
                      color: 'var(--doc-text-subtle)',
                      fontSize: 13,
                      lineHeight: '20px',
                    },
                  },
                  t('documentOutline.noHeadings')
                )
              : props.headings.map((heading, index) =>
                  h(
                    'div',
                    {
                      key: `${heading.blockId}-${index}`,
                      style: { marginLeft: `${(heading.level - minLevel) * 16}px` },
                    },
                    [
                      h(
                        'button',
                        {
                          class: 'docx-outline-heading-btn',
                          onClick: () => props.onHeadingClick(heading.blockId),
                          style: {
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '5px 8px',
                            fontSize: 13,
                            fontWeight: 400,
                            color: 'var(--doc-text)',
                            lineHeight: '18px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            borderRadius: 0,
                            letterSpacing: '0.01em',
                          },
                          title: heading.text,
                        },
                        heading.text
                      ),
                    ]
                  )
                )
          ),
        ]
      );
    };
  },
});
