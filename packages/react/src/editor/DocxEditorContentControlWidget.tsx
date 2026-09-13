import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useFormControlTranslate } from './form-control-translate';
import { useEditorState } from './useEditorState';
import { absolutePointInScroller } from './scroller-geometry';

/** Value-widget session and optional replacement controls. @public */
export interface DocxEditorContentControlWidgetProps {
  session: ContentControlWidgetSession;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}
/** Compact value editor for a configured content-control popup. @public */
export function DocxEditorContentControlWidget(props: DocxEditorContentControlWidgetProps) {
  const [session, setSession] = useState(props.session);
  const [generation, setGeneration] = useState(0);
  if (session !== props.session) {
    setSession(props.session);
    setGeneration(generation + 1);
  }
  return <WidgetForm key={generation} {...props} />;
}
function WidgetForm({ session, className, style, children }: DocxEditorContentControlWidgetProps) {
  const t = useFormControlTranslate();
  const [value, setValue] = useState(
    session.kind === 'date' ? session.value.slice(0, 10) : session.value
  );
  const [closed, setClosed] = useState(session.signal.aborted);
  const [refused, setRefused] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const enabled = useEditorState(() => session.canApply());
  useEffect(() => {
    const abort = () => setClosed(true);
    session.signal.addEventListener('abort', abort, { once: true });
    if (session.signal.aborted) abort();
    return () => session.signal.removeEventListener('abort', abort);
  }, [session]);
  useLayoutEffect(() => {
    if (closed) return;
    const panel = panelRef.current;
    const owner = panel?.ownerDocument;
    const opener = owner?.activeElement as HTMLElement | null;
    const scroller = panel?.closest<HTMLElement>('.docx-editor__scroll-container');
    const anchor = session.anchor;
    if (anchor && scroller) {
      const rect = anchor.getBoundingClientRect();
      setPosition(absolutePointInScroller(scroller, rect.left, rect.bottom));
    }
    panel?.querySelector<HTMLElement>('input,select,button')?.focus({ preventScroll: true });
    return () => {
      const active = owner?.activeElement;
      if (opener?.isConnected && (active === owner?.body || (active && panel?.contains(active)))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [session, closed]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || closed) return;
    const dismiss = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) session.cancel();
    };
    panel.ownerDocument.addEventListener('pointerdown', dismiss, true);
    return () => panel.ownerDocument.removeEventListener('pointerdown', dismiss, true);
  }, [session, closed]);
  if (closed) return null;
  const apply = () => setRefused(!session.apply(value));
  const label = t(`contentControl.types.${session.kind}`);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={`docx-content-control-widget-popup${className ? ` ${className}` : ''}`}
      style={{ ...position, ...style }}
      data-docx-popup="contentControlWidget"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          session.cancel();
        }
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          apply();
        }
      }}
    >
      {children ?? (
        <>
          {session.kind === 'dropdown' ? (
            <select
              aria-label={label}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            >
              {!session.items.some((item) => item.value === value) ? (
                <option value={value} disabled>
                  {value}
                </option>
              ) : null}
              {session.items.map((item, index) => (
                <option key={index} value={item.value}>
                  {item.displayText}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={session.kind === 'date' ? 'date' : 'text'}
              aria-label={label}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {session.kind === 'comboBox'
            ? session.items.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setRefused(!session.apply(item.value))}
                >
                  {item.displayText}
                </button>
              ))
            : null}
          {refused ? <div role="alert">{t('disabledReason.invalidValue')}</div> : null}
          <div className="docx-dialog__footer">
            <button type="button" className="docx-dialog__button" onClick={session.cancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="docx-dialog__button docx-dialog__button--primary"
              disabled={!enabled}
              onClick={apply}
            >
              {t('common.apply')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
