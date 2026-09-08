import { renderPopup } from '../popup-renderer';
import { refAsRefObject, type RefObject } from '../../docx-editor-ref-object';
import { usePopupConfig } from '../popup-config';
import { defineComponent, ref, watch, type VNode, type PropType } from 'vue';
import { useTranslation } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
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
    const popups = usePopupConfig();
    const label = useToolbarLabel();
    const command = useEditorValueCommand('image.altText');
    const open = ref(false);
    watch(
      () => popups.value?.imageAltText,
      (renderer) => {
        if (renderer === false) open.value = false;
      }
    );
    const draft = ref('');
    const rootRef = ref<HTMLDivElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const panelId = useStableDocxId('image-alt');

    watch([open, () => command.value.value], ([isOpen, value]) => {
      if (isOpen) draft.value = value ?? '';
    });

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (
          event.target instanceof Node &&
          (root?.contains(event.target) || document.getElementById(panelId)?.contains(event.target))
        )
          return;
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
          if (popups.value?.imageAltText !== false) open.value = !open.value;
        },
      };

      const popupProps: DocxEditorImageAltTextPopupProps = {
        id: panelId,
        value: draft.value,
        onValueChange: (value) => {
          draft.value = value;
        },
        onApply: apply,
        onClose: () => {
          open.value = false;
        },
        isEnabled: command.isEnabled.value,
        anchorRef: refAsRefObject(triggerRef),
      };
      return (
        <div ref={rootRef} class="docx-toolbar__alt-text">
          {props.asChild ? (
            <Slot {...shared}>{slots.default?.()}</Slot>
          ) : (
            <button {...shared}>{slots.default?.() ?? text}</button>
          )}
          {open.value && popups.value?.imageAltText !== false ? (
            popups.value?.imageAltText ? (
              renderPopup(popups.value.imageAltText, popupProps)
            ) : (
              <DocxEditorImageAltTextPopup {...popupProps} />
            )
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

/** Controlled image description popup. @public */
export interface DocxEditorImageAltTextPopupProps {
  id: string;
  value: string;
  onValueChange(value: string): void;
  onApply(): void;
  onClose(): void;
  isEnabled: boolean;
  className?: string;
  anchorRef?: RefObject<HTMLElement | null>;
}
/** Packaged image description popup. @public */
export const DocxEditorImageAltTextPopup = defineComponent({
  name: 'DocxEditorImageAltTextPopup',
  props: {
    id: { type: String, required: true },
    value: { type: String, required: true },
    onValueChange: { type: Function as PropType<(value: string) => void>, required: true },
    onApply: { type: Function as PropType<() => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    isEnabled: { type: Boolean, required: true },
    className: String,
    anchorRef: Object as PropType<RefObject<HTMLElement | null>>,
  },
  setup(props) {
    const { t } = useTranslation();
    return () => (
      <div
        id={props.id}
        role="dialog"
        aria-label={t('imageAltText.panelTitle')}
        class={['docx-toolbar__alt-text-panel', props.className]}
        onMousedown={(event: MouseEvent) => event.stopPropagation()}
      >
        <label class="docx-dialog__label" for={`${props.id}-description`}>
          {t('imageAltText.description')}
        </label>
        <textarea
          id={`${props.id}-description`}
          class="docx-dialog__textarea"
          value={props.value}
          onInput={(event: Event) => {
            props.onValueChange((event.target as HTMLTextAreaElement).value);
          }}
          placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
        />
        <div class="docx-dialog__footer">
          <button type="button" class="docx-dialog__button" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="docx-dialog__button docx-dialog__button--primary"
            disabled={!props.isEnabled}
            onClick={props.onApply}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    );
  },
});
