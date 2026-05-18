import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { MaterialSymbol } from '../ui/Icons';
import { EDITING_MODES, type EditorMode } from './internals/editing-modes';

export function EditingModeDropdown({
  mode,
  onModeChange,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const current = EDITING_MODES.find((m) => m.value === mode)!;

  // Responsive: icon-only below 1400px
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1400px)');
    setCompact(mql.matches);
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Align dropdown to right edge of trigger so it doesn't overflow the screen
    setPos({ top: rect.bottom + 2, left: rect.right - 220 });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [isOpen]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen(!isOpen)}
        title={`${t(current.labelKey)} (Ctrl+Shift+E)`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 0 : 4,
          padding: compact ? '2px 4px' : '2px 6px 2px 4px',
          border: 'none',
          background: isOpen ? 'var(--doc-hover, #f3f4f6)' : 'transparent',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 400,
          color: 'var(--doc-text, #374151)',
          whiteSpace: 'nowrap',
          height: 28,
        }}
      >
        <MaterialSymbol name={current.icon} size={18} />
        {!compact && <span>{t(current.labelKey)}</span>}
        <MaterialSymbol name="arrow_drop_down" size={16} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            backgroundColor: 'white',
            border: '1px solid var(--doc-border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            padding: '4px 0',
            zIndex: 10000,
            minWidth: 220,
          }}
        >
          {EDITING_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onModeChange(m.value);
                setIsOpen(false);
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  'var(--doc-hover, #f3f4f6)';
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--doc-text, #374151)',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <MaterialSymbol name={m.icon} size={20} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 500 }}>{t(m.labelKey)}</span>
                <span style={{ fontSize: 11, color: 'var(--doc-text-muted, #9ca3af)' }}>
                  {t(m.descKey)}
                </span>
              </span>
              {m.value === mode && (
                <MaterialSymbol
                  name="check"
                  size={18}
                  style={{ marginLeft: 'auto', color: '#1a73e8' }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
