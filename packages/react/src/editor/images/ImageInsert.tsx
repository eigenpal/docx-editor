// Shared insert-image wiring: hidden file input, preflight, and async dispatch.
//
// Toolbar and menu both trigger the same picker; Content attaches paste/drop to the same path.

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { executeImageCommand, toolbarCommandState } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { normalizeImageBytes } from './normalizeImageFile';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';

const ACCEPT = 'image/png,image/jpeg,image/gif';

export interface ImageInsertContextValue {
  readonly openFilePicker: () => void;
  readonly insertFromFileList: (files: FileList | File[] | null | undefined) => Promise<void>;
  readonly insertFromDataTransfer: (data: DataTransfer | null) => Promise<void>;
  readonly isEnabled: boolean;
  readonly disabledReason: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

export function useImageInsert(): ImageInsertContextValue {
  const context = useContext(ImageInsertContext);
  if (!context) {
    throw new Error('useImageInsert must be used within ImageInsertProvider');
  }
  return context;
}

/** Optional hook — returns null outside a provider (Content may mount without toolbar). */
export function useImageInsertOptional(): ImageInsertContextValue | null {
  return useContext(ImageInsertContext);
}

export interface ImageInsertProviderProps {
  children: ReactNode;
}

export function ImageInsertProvider({ children }: ImageInsertProviderProps) {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);

  const selectInsertState = useCallback(
    () => toolbarCommandState(editor, 'image.insert'),
    [editor]
  );
  const insertState = useEditorState(
    selectInsertState,
    (a, b) => a.enabled === b.enabled && a.disabledReason === b.disabledReason
  );
  const isEnabled = insertState.enabled;
  const disabledReason = insertState.disabledReason;

  const insertBytes = useCallback(
    async (bytes: Uint8Array) => {
      if (!editor || busyRef.current) return;
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
      busyRef.current = true;
      try {
        const result = await executeImageCommand(editor, command);
        if (!result.ok) {
          window.alert(result.reason ?? t('imageInsert.errors.refused'));
        } else {
          editor.focus();
        }
      } finally {
        busyRef.current = false;
      }
    },
    [editor, t]
  );

  const insertFromFileList = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      const file = files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();
      await insertBytes(new Uint8Array(buffer));
    },
    [insertBytes]
  );

  const insertFromDataTransfer = useCallback(
    async (data: DataTransfer | null) => {
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
    },
    [insertBytes, insertFromFileList]
  );

  const openFilePicker = useCallback(() => {
    if (!isEnabled) return;
    inputRef.current?.click();
  }, [isEnabled]);

  const onInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      await insertFromFileList(input.files);
      input.value = '';
    },
    [insertFromFileList]
  );

  const value = useMemo(
    (): ImageInsertContextValue => ({
      openFilePicker,
      insertFromFileList,
      insertFromDataTransfer,
      isEnabled,
      disabledReason,
      inputRef,
      onInputChange,
    }),
    [
      openFilePicker,
      insertFromFileList,
      insertFromDataTransfer,
      isEnabled,
      disabledReason,
      onInputChange,
    ]
  );

  return (
    <ImageInsertContext.Provider value={value}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="docx-image-insert__input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onInputChange}
        onMouseDown={(event) => event.stopPropagation()}
      />
      {children}
    </ImageInsertContext.Provider>
  );
}

/** Props for the toolbar/menu insert trigger. @public */
export interface ImageInsertTriggerProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: ReactNode;
}

/** Toolbar insert-image control — opens the shared file picker. @public */
export function ImageInsertTrigger({
  className,
  hidden,
  asChild,
  children,
}: ImageInsertTriggerProps) {
  const { openFilePicker, isEnabled, disabledReason } = useImageInsert();
  const label = useToolbarLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('image.insert');
  const text = label(control?.labelKey ?? 'toolbar.image');
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': 'image.insert',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: openFilePicker,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{children ?? chromeIcon(control?.paths)}</button>;
}

ImageInsertTrigger.docxSlot = 'image.insert' as const;

export const ToolbarImageInsert = Object.assign(ImageInsertTrigger, {
  docxSlot: 'image.insert' as const,
});
