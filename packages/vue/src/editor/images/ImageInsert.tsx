import { defineComponent, h, inject, provide, ref, type InjectionKey } from 'vue';
import { executeImageCommand, toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation, type TranslationKey } from '../../i18n';
import { flattenChildren } from '../../lib/flattenChildren';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { normalizeImageBytes } from './normalizeImageFile';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';

const ACCEPT = 'image/png,image/jpeg,image/gif';

/** @public */
export interface ImageInsertContextValue {
  readonly openFilePicker: () => void;
  readonly insertFromFileList: (files: FileList | File[] | null | undefined) => Promise<void>;
  readonly insertFromDataTransfer: (data: DataTransfer | null) => Promise<void>;
  readonly isEnabled: boolean;
  readonly disabledReason: string | null;
  readonly inputRef: { readonly value: HTMLInputElement | null };
  readonly onInputChange: (event: Event) => void;
}

const ImageInsertContextKey: InjectionKey<ImageInsertContextValue> = Symbol('ImageInsertContext');

/** @public */
export function useImageInsert(): ImageInsertContextValue {
  const context = inject(ImageInsertContextKey, null);
  if (!context) {
    throw new Error('useImageInsert must be used within ImageInsertProvider');
  }
  return context;
}

/** @public */
export function useImageInsertOptional(): ImageInsertContextValue | null {
  return inject(ImageInsertContextKey, null);
}

/** @public */
export interface ImageInsertProviderProps {
  // children via slots
}

/** @public */
export const ImageInsertProvider = defineComponent({
  name: 'ImageInsertProvider',
  setup(_, { slots }) {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const inputRef = ref<HTMLInputElement | null>(null);
    const busyRef = ref(false);

    const insertState = useEditorState(
      () => toolbarCommandState(editorRef.value, 'image.insert'),
      (a, b) => a.enabled === b.enabled && a.disabledReason === b.disabledReason
    );

    const insertBytes = async (bytes: Uint8Array) => {
      const editor = editorRef.value;
      if (!editor || busyRef.value) return;
      const normalized = normalizeImageBytes(bytes);
      if (!normalized.ok) {
        window.alert(t(normalized.reasonKey as TranslationKey));
        return;
      }
      const command = {
        type: 'insertImage' as const,
        data: normalized.bytes,
        mime: normalized.mime,
        widthPoints: normalized.widthPoints,
        heightPoints: normalized.heightPoints,
      };
      const gate = editor.canExecuteImageCommand?.(command);
      if (gate && !gate.ok) {
        window.alert(gate.reason ?? t('imageInsert.errors.refused'));
        return;
      }
      busyRef.value = true;
      try {
        const result = await executeImageCommand(editor, command);
        if (!result.ok) {
          window.alert(result.reason ?? t('imageInsert.errors.refused'));
        } else {
          editor.focus();
        }
      } finally {
        busyRef.value = false;
      }
    };

    const insertFromFileList = async (files: FileList | File[] | null | undefined) => {
      const file = files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();
      await insertBytes(new Uint8Array(buffer));
    };

    const insertFromDataTransfer = async (data: DataTransfer | null) => {
      if (!data) return;
      const file = [...data.files].find((candidate) => candidate.type.startsWith('image/'));
      if (file) {
        await insertFromFileList([file]);
        return;
      }
      for (const item of data.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const buffer = await blob.arrayBuffer();
        await insertBytes(new Uint8Array(buffer));
        return;
      }
    };

    const openFilePicker = () => {
      if (!insertState.value.enabled) return;
      inputRef.value?.click();
    };

    const onInputChange = async (event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      await insertFromFileList(input.files);
      input.value = '';
    };

    const context: ImageInsertContextValue = {
      openFilePicker,
      insertFromFileList,
      insertFromDataTransfer,
      get isEnabled() {
        return insertState.value.enabled;
      },
      get disabledReason() {
        return localizeDisabledReason(insertState.value.disabledReason, t);
      },
      inputRef,
      onInputChange,
    };

    provide(ImageInsertContextKey, context);

    return () => [
      h('input', {
        ref: inputRef,
        type: 'file',
        accept: ACCEPT,
        class: 'docx-image-insert__input',
        tabindex: -1,
        'aria-hidden': 'true',
        onChange: onInputChange,
        onMousedown: (event: MouseEvent) => event.stopPropagation(),
      }),
      ...flattenChildren(slots.default?.() ?? []),
    ];
  },
});

/** @public */
export interface ImageInsertTriggerProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
}

/** @public */
export const ImageInsertTrigger = defineComponent({
  name: 'ImageInsertTrigger',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const insert = useImageInsert();
    const label = useToolbarLabel();
    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('image.insert');
      const text = label(control?.labelKey ?? 'toolbar.image');
      const shared = {
        type: 'button' as const,
        class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'image.insert',
        disabled: !insert.isEnabled,
        ...(!insert.isEnabled ? { 'data-disabled': '' } : {}),
        'aria-label': text,
        title: insert.disabledReason ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: insert.openFilePicker,
      };
      if (props.asChild) return <Slot {...shared}>{slots.default?.()}</Slot>;
      return <button {...shared}>{slots.default?.() ?? chromeIcon(control?.paths)}</button>;
    };
  },
});
(ImageInsertTrigger as { docxSlot?: string }).docxSlot = 'image.insert';

/** @public */
export const ToolbarImageInsert = Object.assign(ImageInsertTrigger, {
  docxSlot: 'image.insert' as const,
});
