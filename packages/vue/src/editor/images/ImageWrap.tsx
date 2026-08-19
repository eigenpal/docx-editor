import { computed, defineComponent, ref, watch, type VNode } from 'vue';
import type { ImageWrapTarget } from '@docx-editor.dev/core/editor';
import { useTranslation, type TranslationKey } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';

const WRAP_OPTIONS: readonly {
  readonly value: ImageWrapTarget;
  readonly labelKey: TranslationKey;
  readonly iconName: string;
}[] = [
  { value: 'inline', labelKey: 'imageWrap.menu.inLineWithText', iconName: 'wrap_text' },
  { value: 'square', labelKey: 'imageWrap.square', iconName: 'crop_square' },
  { value: 'squareLeft', labelKey: 'imageWrap.menu.squareLeft', iconName: 'format_image_left' },
  { value: 'squareRight', labelKey: 'imageWrap.menu.squareRight', iconName: 'format_image_right' },
  { value: 'tight', labelKey: 'imageWrap.tight', iconName: 'wrap_text' },
  { value: 'through', labelKey: 'imageWrap.through', iconName: 'wrap_text' },
  { value: 'topAndBottom', labelKey: 'imageWrap.topAndBottom', iconName: 'vertical_align_center' },
  { value: 'behind', labelKey: 'imageWrap.behindText', iconName: 'flip_to_back' },
  { value: 'inFront', labelKey: 'imageWrap.inFrontOfText', iconName: 'flip_to_front' },
];

/** @public */
export interface ImageWrapProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
}

/** @public */
export const ImageWrap = defineComponent({
  name: 'ImageWrap',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const label = useToolbarLabel();
    const command = useEditorValueCommand('image.wrap');
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const menuId = useStableDocxId('image-wrap');

    const current = computed(
      () => WRAP_OPTIONS.find((option) => option.value === command.value.value) ?? WRAP_OPTIONS[0]!
    );

    const control = chromeControlForSlot('image.wrap');
    const tooltip = label(control?.labelKey ?? 'formattingBar.imageWrap');

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        open.value = false;
        triggerRef.value?.focus();
      };
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('keydown', onKeyDown);
      onCleanup(() => {
        document.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('keydown', onKeyDown);
      });
    });

    const choose = (target: ImageWrapTarget) => {
      open.value = false;
      command.execute(target);
    };

    return () => {
      if (props.hidden) return null;
      const triggerLabel = t('imageWrap.tooltipPrefix', {
        label: t(current.value.labelKey),
      });
      const shared = {
        type: 'button' as const,
        ref: triggerRef,
        class: `docx-toolbar__button docx-toolbar__image-wrap-trigger${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'image.wrap',
        disabled: !command.isEnabled.value,
        ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
        'aria-haspopup': 'menu' as const,
        'aria-expanded': open.value,
        'aria-controls': open.value ? menuId : undefined,
        'aria-label': tooltip,
        title: command.disabledReason.value ?? triggerLabel,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          open.value = !open.value;
        },
      };

      return (
        <div ref={rootRef} class="docx-toolbar__image-wrap">
          {props.asChild ? (
            <Slot {...shared}>{slots.default?.()}</Slot>
          ) : (
            <button {...shared}>{slots.default?.() ?? chromeIcon(control?.paths)}</button>
          )}
          {open.value ? (
            <div
              id={menuId}
              role="menu"
              class="docx-toolbar__image-wrap-menu"
              aria-label={t('imageWrap.menu.ariaLabel')}
              onMousedown={(event: MouseEvent) => event.stopPropagation()}
            >
              {WRAP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  class="docx-toolbar__image-wrap-item"
                  aria-checked={command.value.value === option.value}
                  {...(command.value.value === option.value ? { 'data-active': '' } : {})}
                  onMousedown={guardToolbarMousedown}
                  onClick={() => choose(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    };
  },
});
(ImageWrap as { docxSlot?: string }).docxSlot = 'image.wrap';

/** @public */
export interface ImageWrapPartComponent {
  (props: ImageWrapProps): VNode | null;
  readonly docxSlot: 'image.wrap';
}

/** @public */
export const ToolbarImageWrap = Object.assign(ImageWrap, {
  docxSlot: 'image.wrap' as const,
}) as unknown as ImageWrapPartComponent;
