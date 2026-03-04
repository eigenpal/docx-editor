import React, { useState, useRef, useEffect } from 'react';
import { examples } from './config';

interface ExampleSwitcherProps {
  current: 'Vite' | 'Next.js' | 'Remix' | 'Astro';
}

const containerBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  borderRadius: '8px',
  position: 'relative',
};

const containerWithTabsStyle: React.CSSProperties = {
  ...containerBaseStyle,
  padding: '4px',
  background: '#f1f5f9',
};

const containerNoTabsStyle: React.CSSProperties = {
  ...containerBaseStyle,
  padding: 0,
  background: 'transparent',
};

const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 10px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#64748b',
  textDecoration: 'none',
  borderRadius: '6px',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

const activePillStyle: React.CSSProperties = {
  ...pillStyle,
  color: '#0f172a',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};

const codeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px 10px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#64748b',
  background: '#f1f5f9',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  padding: '4px',
  zIndex: 100,
  minWidth: '180px',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '7px 10px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#334155',
  textDecoration: 'none',
  borderRadius: '6px',
  transition: 'background 0.1s',
  whiteSpace: 'nowrap',
};

// Code bracket icon: </>
const codeIcon =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

declare const __ENABLE_FRAMEWORK_SWITCHER__: boolean;

function showSwitcher(): boolean {
  try {
    return __ENABLE_FRAMEWORK_SWITCHER__;
  } catch {
    return false;
  }
}

export function ExampleSwitcher({ current }: ExampleSwitcherProps) {
  const devDemo = showSwitcher();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <nav style={devDemo ? containerWithTabsStyle : containerNoTabsStyle} ref={ref}>
      {devDemo &&
        examples.map((example) => {
          const isActive = example.name === current;
          const href = example.localUrl;
          return (
            <a
              key={example.name}
              href={href}
              style={isActive ? activePillStyle : pillStyle}
              title={example.description}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: example.icon }}
              />
              {example.name}
            </a>
          );
        })}
      <button
        style={codeButtonStyle}
        onClick={() => setOpen(!open)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#e2e8f0';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        title="View example source code"
      >
        <span
          style={{ display: 'flex', alignItems: 'center' }}
          dangerouslySetInnerHTML={{ __html: codeIcon }}
        />
      </button>
      {open && (
        <div style={dropdownStyle}>
          {examples.map((example) => (
            <a
              key={example.name}
              href={example.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={dropdownItemStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: example.icon }}
              />
              {example.name}
              <span style={{ color: '#94a3b8', marginLeft: 'auto', fontSize: '11px' }}>source</span>
            </a>
          ))}
          <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />
          <a
            href="https://www.npmjs.com/package/@eigenpal/docx-js-editor"
            target="_blank"
            rel="noopener noreferrer"
            style={dropdownItemStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            View on npm
            <svg
              viewBox="0 0 780 250"
              width="28"
              height="11"
              aria-label="npm"
              style={{ marginLeft: 'auto', flexShrink: 0 }}
            >
              <path
                fill="#C12127"
                d="M240,250h100v-50h100V0H240V250z M340,50h50v100h-50V50z M480,0v200h100V50h50v150h50V50h50v150h50V0H480z M0,200h100V50h50v150h50V0H0V200z"
              />
            </svg>
          </a>
        </div>
      )}
    </nav>
  );
}
