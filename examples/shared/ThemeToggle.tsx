// The light/dark toggle, shared by the demo surfaces.
//
// Moved here verbatim rather than reimplemented: two demos with two toggles is two places to
// fix the day the token palette changes.

import React from 'react';

/** Fumadocs-style segmented light/dark toggle (sun/moon, sliding highlight). */
export function ThemeToggle({
  value,
  onChange,
}: {
  value: 'light' | 'dark';
  onChange: (m: 'light' | 'dark') => void;
}) {
  const options: { mode: 'light' | 'dark'; label: string; icon: React.ReactNode }[] = [
    {
      mode: 'light',
      label: 'Light',
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ),
    },
    {
      mode: 'dark',
      label: 'Dark',
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ),
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: 9999,
        border: '1px solid var(--doc-border)',
        background: 'var(--doc-bg-subtle)',
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            title={`${opt.label} mode`}
            onClick={() => onChange(opt.mode)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              border: 'none',
              borderRadius: 9999,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              background: selected ? 'var(--doc-surface)' : 'transparent',
              boxShadow: selected ? '0 1px 2px var(--doc-shadow-subtle)' : 'none',
              color: selected ? 'var(--doc-text)' : 'var(--doc-text-subtle)',
            }}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
