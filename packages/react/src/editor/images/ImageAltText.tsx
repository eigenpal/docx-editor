// Alt-text authoring: description and title, never `@name` fallback.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';

/** Props for `DocxEditorToolbar.ImageAltText`. @public */
export interface ImageAltTextProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: ReactNode;
}

/**
 * Opens a small panel to edit image description (and optional title).
 *
 * @public
 */
export function ImageAltText({ className, hidden, asChild, children }: ImageAltTextProps) {
  const { t } = useTranslation();
  const label = useToolbarLabel();
  const { execute, value, isEnabled, disabledReason } = useEditorValueCommand('image.altText');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (open) setDraft(value ?? '');
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const apply = useCallback(() => {
    execute(draft);
    setOpen(false);
  }, [draft, execute]);

  if (hidden) return null;

  const control = chromeControlForSlot('image.altText');
  const text = label(control?.labelKey ?? 'formattingBar.altText');
  const shared = {
    type: 'button' as const,
    ref: triggerRef,
    className: `docx-toolbar__button docx-toolbar__alt-text-trigger${className ? ` ${className}` : ''}`,
    'data-slot': 'image.altText',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: () => setOpen((was) => !was),
  };

  return (
    <div ref={rootRef} className="docx-toolbar__alt-text">
      {asChild ? (
        <Slot {...shared}>{children}</Slot>
      ) : (
        <button {...shared}>{children ?? text}</button>
      )}
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('imageAltText.panelTitle')}
          className="docx-toolbar__alt-text-panel"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <label className="docx-dialog__label" htmlFor={`${panelId}-description`}>
            {t('imageAltText.description')}
          </label>
          <textarea
            id={`${panelId}-description`}
            className="docx-dialog__textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
          />
          <div className="docx-dialog__footer">
            <button type="button" className="docx-dialog__button" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="docx-dialog__button docx-dialog__button--primary"
              onClick={apply}
            >
              {t('common.apply')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

ImageAltText.docxSlot = 'image.altText' as const;

/** @public */
export interface ImageAltTextPartComponent {
  (props: ImageAltTextProps): ReactElement | null;
  readonly docxSlot: 'image.altText';
}

export const ToolbarImageAltText: ImageAltTextPartComponent = Object.assign(ImageAltText, {
  docxSlot: 'image.altText' as const,
});
