import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ContentControlWidgetSession } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useFormControlTranslate } from './form-control-translate';
import { absolutePointInScroller } from './scroller-geometry';
import {
  ContentControlWidgetProvider,
  useContentControlWidgetState,
  type UseContentControlWidgetResult,
} from './content-control-widget/context';
import {
  ContentControlWidgetApply,
  ContentControlWidgetCalendar,
  ContentControlWidgetCancel,
  ContentControlWidgetDay,
  ContentControlWidgetError,
  ContentControlWidgetFooter,
  ContentControlWidgetGrid,
  ContentControlWidgetHeader,
  ContentControlWidgetInput,
  ContentControlWidgetItem,
  ContentControlWidgetList,
  ContentControlWidgetNextMonth,
  ContentControlWidgetPreviousMonth,
  ContentControlWidgetTitle,
  ContentControlWidgetToday,
  ContentControlWidgetWeekdays,
} from './content-control-widget/parts';

/** Value-widget session and optional replacement controls. @public */
export interface DocxEditorContentControlWidgetProps {
  session: ContentControlWidgetSession;
  className?: string;
  style?: CSSProperties;
  /**
   * Replaces the packaged arrangement. Compose it from the compound's parts
   * (`DocxEditorContentControlWidget.Calendar`, `.List`, …) or from `useContentControlWidget()`.
   */
  children?: DocxEditorChildren;
}

/**
 * The packaged value pop-up for a dropdown, combo-box, date or checkbox content control.
 *
 * Anchored below the control inside the editor's scroll container. Without `children` it
 * renders the same arrangement the engine paints on its own — a list, a list with free-text
 * entry, or a month calendar with a Today button — from the same stylesheet classes, so one
 * theme covers both. A checkbox session applies its toggle at once and shows nothing.
 * @public
 */
function ContentControlWidgetRoot(props: DocxEditorContentControlWidgetProps) {
  const [session, setSession] = useState(props.session);
  const [generation, setGeneration] = useState(0);
  if (session !== props.session) {
    setSession(props.session);
    setGeneration(generation + 1);
  }
  return <WidgetPanel key={generation} {...props} />;
}

function WidgetPanel({ session, className, style, children }: DocxEditorContentControlWidgetProps) {
  const t = useFormControlTranslate();
  const widget = useContentControlWidgetState(session);
  const [closed, setClosed] = useState(session.signal.aborted);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  );
  const [position, setPosition] = useState<CSSProperties>({});
  // A checkbox has no pop-up: the packaged arrangement IS the toggle, so configuring this
  // popup for a restyled dropdown never makes checkboxes stop working. A host that renders
  // its own children owns the decision instead.
  const immediate = session.kind === 'checkbox' && children === undefined;
  useEffect(() => {
    const abort = () => setClosed(true);
    session.signal.addEventListener('abort', abort, { once: true });
    if (session.signal.aborted) abort();
    return () => session.signal.removeEventListener('abort', abort);
  }, [session]);
  useEffect(() => {
    if (!immediate || session.signal.aborted) return;
    session.apply(session.value === 'true' ? 'false' : 'true');
  }, [immediate, session]);
  useLayoutEffect(() => {
    if (closed || immediate) return;
    const panel = panelRef.current;
    const owner = panel?.ownerDocument;
    const scroller = panel?.closest<HTMLElement>('.docx-editor__scroll-container');
    const anchor = session.anchor;
    if (anchor && scroller) {
      const rect = anchor.getBoundingClientRect();
      const sheet = anchor.closest('.docx-page')?.getBoundingClientRect();
      const left = sheet
        ? Math.max(sheet.left, Math.min(rect.left, sheet.right - panel!.offsetWidth))
        : rect.left;
      setPosition(absolutePointInScroller(scroller, left, rect.bottom));
    }
    // The calendar grid places its own roving focus; everything else takes the first control.
    if (!panel?.querySelector('[data-docx-part="grid"]')) {
      panel?.querySelector<HTMLElement>('input,select,button')?.focus({ preventScroll: true });
    }
    return () => {
      const active = owner?.activeElement;
      if (opener?.isConnected && (active === owner?.body || (active && panel?.contains(active)))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [session, closed, immediate, opener]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || closed || immediate) return;
    const dismiss = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) session.cancel();
    };
    panel.ownerDocument.addEventListener('pointerdown', dismiss, true);
    return () => panel.ownerDocument.removeEventListener('pointerdown', dismiss, true);
  }, [session, closed, immediate]);
  if (closed || immediate) return null;
  const label = t(`contentControl.types.${session.kind}`);
  return (
    <ContentControlWidgetProvider value={widget}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        className={`docx-content-control-widget-popup${className ? ` ${className}` : ''}`}
        style={{ ...position, ...style }}
        data-docx-popup="contentControlWidget"
        data-kind={session.kind}
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
            widget.apply();
          }
        }}
      >
        {children ?? defaultArrangement(widget)}
      </div>
    </ContentControlWidgetProvider>
  );
}

function defaultArrangement(widget: UseContentControlWidgetResult): ReactNode {
  if (widget.kind === 'date') return <ContentControlWidgetCalendar />;
  if (widget.kind === 'comboBox') {
    return (
      <>
        <ContentControlWidgetInput />
        <ContentControlWidgetList />
        <ContentControlWidgetError />
        <ContentControlWidgetFooter />
      </>
    );
  }
  return (
    <>
      <ContentControlWidgetList />
      <ContentControlWidgetError />
    </>
  );
}

/** The compound pop-up with its parts attached as statics. @public */
export interface DocxEditorContentControlWidgetNamespace {
  (props: DocxEditorContentControlWidgetProps): ReactNode;
  readonly Calendar: typeof ContentControlWidgetCalendar;
  readonly Header: typeof ContentControlWidgetHeader;
  readonly PreviousMonth: typeof ContentControlWidgetPreviousMonth;
  readonly Title: typeof ContentControlWidgetTitle;
  readonly NextMonth: typeof ContentControlWidgetNextMonth;
  readonly Weekdays: typeof ContentControlWidgetWeekdays;
  readonly Grid: typeof ContentControlWidgetGrid;
  readonly Day: typeof ContentControlWidgetDay;
  readonly Today: typeof ContentControlWidgetToday;
  readonly List: typeof ContentControlWidgetList;
  readonly Item: typeof ContentControlWidgetItem;
  readonly Input: typeof ContentControlWidgetInput;
  readonly Error: typeof ContentControlWidgetError;
  readonly Footer: typeof ContentControlWidgetFooter;
  readonly Apply: typeof ContentControlWidgetApply;
  readonly Cancel: typeof ContentControlWidgetCancel;
}

/** Compact value editor for a configured content-control popup. @public */
export const DocxEditorContentControlWidget: DocxEditorContentControlWidgetNamespace =
  Object.assign(ContentControlWidgetRoot, {
    Calendar: ContentControlWidgetCalendar,
    Header: ContentControlWidgetHeader,
    PreviousMonth: ContentControlWidgetPreviousMonth,
    Title: ContentControlWidgetTitle,
    NextMonth: ContentControlWidgetNextMonth,
    Weekdays: ContentControlWidgetWeekdays,
    Grid: ContentControlWidgetGrid,
    Day: ContentControlWidgetDay,
    Today: ContentControlWidgetToday,
    List: ContentControlWidgetList,
    Item: ContentControlWidgetItem,
    Input: ContentControlWidgetInput,
    Error: ContentControlWidgetError,
    Footer: ContentControlWidgetFooter,
    Apply: ContentControlWidgetApply,
    Cancel: ContentControlWidgetCancel,
  });
