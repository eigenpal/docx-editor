/**
 * AgentPanel — dumb resizable right column for an agent UI.
 *
 * The shell renders the chrome (header, close button, drag-to-resize handle).
 * Children render whatever the consumer wants — message list, composer,
 * tool-call cards, settings panel, multiple tabs. We intentionally ship no
 * chat primitives: consumers use AI SDK's `useChat`, `assistant-ui`, or any
 * other framework as the panel's children.
 *
 * When uncontrolled, the drag-resize state persists to localStorage so the
 * user's chosen width survives reloads. Pass `width` + `onWidthChange` to
 * lift control into the consumer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../i18n';
import { MaterialSymbol } from './ui/Icons';

const STORAGE_KEY = 'eigenpal:docx-editor:agentPanelWidth';

export interface AgentPanelProps {
  /** Header title. Defaults to `t('agentPanel.defaultTitle')`. */
  title?: string;
  /** Header icon node. Defaults to a sparkle SVG. */
  icon?: ReactNode;
  /** Controlled width in pixels. Omit for uncontrolled (internal state + localStorage). */
  width?: number;
  /** Default width when uncontrolled. */
  defaultWidth?: number;
  /** Min drag width. */
  minWidth?: number;
  /** Max drag width. */
  maxWidth?: number;
  /** Width change callback (drag end and intermediate). */
  onWidthChange?: (w: number) => void;
  /** Header close button click. Omit to hide the close button. */
  onClose?: () => void;
  /** Panel content. Render whatever you want — a chat, tabs, settings, anything. */
  children: ReactNode;
  /** Optional class on the outer wrapper. */
  className?: string;
  /**
   * When `true`, the panel collapses to zero width with an ease-out
   * transition (the children are still mounted so chat state survives
   * close/reopen). The DocxEditor wrapper passes this when the user
   * toggles the panel — kept off by default for standalone usage.
   */
  closed?: boolean;
}

const DEFAULT_WIDTH = 360;
const DEFAULT_MIN = 280;
const DEFAULT_MAX = 600;

export function AgentPanel({
  title,
  icon,
  width: controlledWidth,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = DEFAULT_MIN,
  maxWidth = DEFAULT_MAX,
  onWidthChange,
  onClose,
  children,
  className,
  closed = false,
}: AgentPanelProps) {
  const { t } = useTranslation();
  const isControlled = controlledWidth !== undefined;

  // Only transition `width` / `flex-basis` during open/close — never during
  // a drag, otherwise the visual width lags behind the user's pointer. We
  // track `closeTransitioning` for ~260ms after `closed` flips.
  const [closeTransitioning, setCloseTransitioning] = useState(false);
  const prevClosedRef = useRef(closed);
  useEffect(() => {
    if (prevClosedRef.current !== closed) {
      prevClosedRef.current = closed;
      setCloseTransitioning(true);
      const id = window.setTimeout(() => setCloseTransitioning(false), 260);
      return () => window.clearTimeout(id);
    }
  }, [closed]);

  const [internalWidth, setInternalWidth] = useState<number>(() => {
    if (isControlled) return controlledWidth;
    if (typeof window === 'undefined') return defaultWidth;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const n = Number(stored);
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) return n;
      }
    } catch {
      // localStorage may be blocked — fall through to default.
    }
    return defaultWidth;
  });

  const width = isControlled ? controlledWidth : internalWidth;

  // Drag state + latest props in two refs. document-level listeners read from
  // the refs, so mid-drag setState doesn't reidentify them and we keep every
  // pointermove. The latest-props ref tracks min/max/onWidthChange/etc. so the
  // listener always sees the current values without re-attaching.
  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);
  const latestPropsRef = useRef({
    minWidth,
    maxWidth,
    isControlled,
    onWidthChange,
  });
  latestPropsRef.current = { minWidth, maxWidth, isControlled, onWidthChange };

  const handlersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: () => void;
  } | null>(null);
  if (!handlersRef.current) {
    const move = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const p = latestPropsRef.current;
      // Panel is on the right; dragging left increases width.
      const delta = drag.startX - e.clientX;
      const next = Math.min(p.maxWidth, Math.max(p.minWidth, drag.startWidth + delta));
      drag.lastWidth = next;
      if (!p.isControlled) setInternalWidth(next);
      p.onWidthChange?.(next);
    };
    const up = () => {
      const drag = dragStateRef.current;
      if (!drag) return;
      dragStateRef.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!latestPropsRef.current.isControlled) {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(drag.lastWidth));
        } catch {
          // localStorage may be blocked — silent.
        }
      }
    };
    handlersRef.current = { move, up };
  }

  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startWidth = isControlled ? controlledWidth : internalWidth;
    dragStateRef.current = { startX: e.clientX, startWidth, lastWidth: startWidth };
    document.addEventListener('pointermove', handlersRef.current!.move);
    document.addEventListener('pointerup', handlersRef.current!.up);
    // controlledWidth/internalWidth read at handler-fire time; safe to ignore deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      const h = handlersRef.current;
      if (!h) return;
      document.removeEventListener('pointermove', h.move);
      document.removeEventListener('pointerup', h.up);
    };
  }, []);

  const headerTitle = title ?? t('agentPanel.defaultTitle');
  const closeLabel = t('agentPanel.close');

  return (
    <div
      className={`ep-agent-panel${className ? ` ${className}` : ''}`}
      style={{
        // Closed: collapse to zero width but keep the children mounted so
        // chat state (messages, scroll position, draft input) survives
        // close/reopen. Transition flex/width/margin/opacity together so
        // the toolbar reflows smoothly. Drag during a transition is OK —
        // the listeners read the latest width from props each frame.
        width: closed ? 0 : width,
        flex: closed ? '0 0 0px' : `0 0 ${width}px`,
        // White floating card on the editor's `--doc-bg` canvas, matching
        // Google Docs' Gemini side panel.
        height: 'calc(100% - 16px)',
        margin: closed ? '8px 0 8px 0' : '8px 8px 8px 12px',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: closed ? '1px solid transparent' : '1px solid #e3e3e3',
        borderRadius: 16,
        boxShadow: closed
          ? 'none'
          : '0 1px 2px rgba(60,64,67,0.05), 0 4px 12px rgba(60,64,67,0.08)',
        opacity: closed ? 0 : 1,
        pointerEvents: closed ? 'none' : 'auto',
        position: 'relative',
        boxSizing: 'border-box',
        minWidth: closed ? 0 : minWidth,
        overflow: 'hidden',
        fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
        transition: closeTransitioning
          ? 'flex-basis 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1), margin 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease, box-shadow 220ms ease, border-color 220ms ease'
          : 'opacity 180ms ease, box-shadow 220ms ease, border-color 220ms ease',
      }}
      aria-hidden={closed}
      data-testid="agent-panel"
      data-state={closed ? 'closed' : 'open'}
      role="complementary"
      aria-label={headerTitle}
    >
      {/* Drag handle on the left edge — invisible 6px hit zone */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize agent panel"
        onPointerDown={onHandlePointerDown}
        style={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          touchAction: 'none',
          zIndex: 1,
        }}
        data-testid="agent-panel-resize-handle"
      />

      {/* Header — flat over white panel surface, brand sparkle, close on right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px 10px',
          flex: '0 0 auto',
          background: '#ffffff',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', color: '#0b57d0' }}>
          {icon ?? <MaterialSymbol name="agent-sparkle" size={22} />}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 500,
            color: '#1f1f1f',
            letterSpacing: 0.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {headerTitle}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            data-testid="agent-panel-close"
            style={{
              border: 'none',
              background: 'transparent',
              padding: 6,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#444746',
              borderRadius: 999,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#f1f3f4';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <MaterialSymbol name="close" size={18} />
          </button>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  );
}
