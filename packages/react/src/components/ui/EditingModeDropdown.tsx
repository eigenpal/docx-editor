import { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from './MaterialSymbol';

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

const EDITING_MODES: readonly { value: EditorMode; label: string; icon: string; desc: string }[] = [
  {
    value: 'editing',
    label: 'Editing',
    icon: 'edit_note',
    desc: 'Edit document directly',
  },
  {
    value: 'suggesting',
    label: 'Suggesting',
    icon: 'rate_review',
    desc: 'Edits become suggestions',
  },
  {
    value: 'viewing',
    label: 'Viewing',
    icon: 'visibility',
    desc: 'Read-only, no edits',
  },
];

export function EditingModeDropdown({
  mode,
  onModeChange,
  disabled = false,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  disabled?: boolean;
}) {
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

  useEffect(() => {
    if (disabled && isOpen) setIsOpen(false);
  }, [disabled, isOpen]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        aria-label={`${current.label} mode`}
        data-testid="editing-mode-dropdown"
        title={`${current.label} (Ctrl+Shift+E)`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 0 : 4,
          padding: compact ? '2px 4px' : '2px 6px 2px 4px',
          border: 'none',
          background: isOpen ? 'var(--doc-hover, #f3f4f6)' : 'transparent',
          borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 400,
          color: 'var(--doc-text, #374151)',
          whiteSpace: 'nowrap',
          height: 28,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <MaterialSymbol name={current.icon} size={18} />
        {!compact && <span>{current.label}</span>}
        <MaterialSymbol name="arrow_drop_down" size={16} />
      </button>

      {isOpen && !disabled && (
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
                <span style={{ fontWeight: 500 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: 'var(--doc-text-muted, #9ca3af)' }}>
                  {m.desc}
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

export default EditingModeDropdown;
