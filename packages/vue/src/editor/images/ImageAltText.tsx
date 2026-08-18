import { defineComponent, ref, watch, type VNode } from 'vue';
import { useTranslation } from '../../i18n';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';

/** @public */
export interface ImageAltTextProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
}

/** @public */
export const ImageAltText = defineComponent({
  name: 'ImageAltText',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const label = useToolbarLabel();
    const command = useEditorValueCommand('image.altText');
    const open = ref(false);
    const draft = ref('');
    const rootRef = ref<HTMLDivElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const panelId = `image-alt-${Math.random().toString(36).slice(2)}`;

    watch([open, () => command.value.value], ([isOpen, value]) => {
      if (isOpen) draft.value = value ?? '';
    });

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

    const apply = () => {
      command.execute(draft.value);
      open.value = false;
    };

    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('image.altText');
      const text = label(control?.labelKey ?? 'formattingBar.altText');
      const shared = {
        type: 'button' as const,
        ref: triggerRef,
        class: `docx-toolbar__button docx-toolbar__alt-text-trigger${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'image.altText',
        disabled: !command.isEnabled.value,
        ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': open.value,
        'aria-controls': open.value ? panelId : undefined,
        'aria-label': text,
        title: command.disabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          open.value = !open.value;
        },
      };

      return (
        <div ref={rootRef} class="docx-toolbar__alt-text">
          {props.asChild ? (
            <Slot {...shared}>{slots.default?.()}</Slot>
          ) : (
            <button {...shared}>{slots.default?.() ?? text}</button>
          )}
          {open.value ? (
            <div
              id={panelId}
              role="dialog"
              aria-label={t.value('imageAltText.panelTitle')}
              class="docx-toolbar__alt-text-panel"
              onMousedown={(event: MouseEvent) => event.stopPropagation()}
            >
              <label class="docx-dialog__label" for={`${panelId}-description`}>
                {t.value('imageAltText.description')}
              </label>
              <textarea
                id={`${panelId}-description`}
                class="docx-dialog__textarea"
                value={draft.value}
                onInput={(event: Event) => {
                  draft.value = (event.target as HTMLTextAreaElement).value;
                }}
                placeholder={t.value('dialogs.imageProperties.altTextPlaceholder')}
              />
              <div class="docx-dialog__footer">
                <button
                  type="button"
                  class="docx-dialog__button"
                  onClick={() => (open.value = false)}
                >
                  {t.value('common.cancel')}
                </button>
                <button
                  type="button"
                  class="docx-dialog__button docx-dialog__button--primary"
                  onClick={apply}
                >
                  {t.value('common.apply')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    };
  },
});
(ImageAltText as { docxSlot?: string }).docxSlot = 'image.altText';

/** @public */
export interface ImageAltTextPartComponent {
  (props: ImageAltTextProps): VNode | null;
  readonly docxSlot: 'image.altText';
}

/** @public */
export const ToolbarImageAltText = Object.assign(ImageAltText, {
  docxSlot: 'image.altText' as const,
}) as unknown as ImageAltTextPartComponent;
