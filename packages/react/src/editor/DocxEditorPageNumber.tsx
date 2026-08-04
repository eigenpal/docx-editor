import { createContext, useContext, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import { useEditorState } from './useEditorState';

const HIDE_DELAY_MS = 600;
const selectTotalPages = (snapshot: EditorSnapshot): number => snapshot.page.total;

/** Internal bridge from the batteries-included editor's `t` prop to this composition part. */
export const PageNumberTranslationContext = createContext<((key: string) => string) | null>(null);

/** Props for `DocxEditor.PageNumber`. @public */
export interface DocxEditorPageNumberProps {
  /** Appended after the default page-number classes. */
  className?: string;
  /** Inline presentation overrides for the indicator element. */
  style?: CSSProperties;
}

/**
 * Floating localized page readout for the active `DocxEditor.Viewport`.
 *
 * Render it as a sibling of the viewport inside a positioned wrapper. It appears while a
 * multi-page document scrolls and fades after 600 ms of inactivity.
 *
 * @public
 */
export function DocxEditorPageNumber({ className, style }: DocxEditorPageNumberProps) {
  const editor = useDocxEditor();
  const viewport = useNavigationViewportElement();
  const total = useEditorState(selectTotalPages);
  const { t } = useTranslation();
  const translate = useContext(PageNumberTranslationContext);
  const [current, setCurrent] = useState(1);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!editor || !viewport || total <= 1) return undefined;
    setCurrent(editor.getCurrentPage('viewport'));
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      setCurrent(editor.getCurrentPage('viewport'));
      setVisible(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [editor, total, viewport]);

  if (total <= 1) return null;
  const label = translate
    ? translate('viewer.pageIndicator')
        .replace(/\{current\}/g, String(current))
        .replace(/\{total\}/g, String(total))
    : t('viewer.pageIndicator', { current, total });
  return (
    <div
      className={`ep-root ep-shell__page-indicator-chip docx-editor__page-number${
        className ? ` ${className}` : ''
      }`}
      style={style}
      data-visible={visible ? 'true' : 'false'}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
}
