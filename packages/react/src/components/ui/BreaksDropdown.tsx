import type { CSSProperties } from 'react';
import { MenuDropdown, type MenuEntry } from './MenuDropdown';

export type SectionBreakType = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';

export interface BreaksDropdownProps {
  disabled?: boolean;
  onPageBreak?: () => void;
  onSectionBreak?: (breakType: SectionBreakType) => void;
}

const submenuListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 180,
};

const submenuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--doc-text, #374151)',
  width: '100%',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderRadius: 4,
};

const submenuItemDisabledStyle: CSSProperties = {
  ...submenuItemStyle,
  opacity: 0.4,
  cursor: 'default',
};

function createSubmenuItem(
  label: string,
  breakType: SectionBreakType,
  options: {
    disabled: boolean;
    onSectionBreak?: (type: SectionBreakType) => void;
    closeMenu: () => void;
  }
) {
  const { disabled, onSectionBreak, closeMenu } = options;
  return (
    <button
      key={label}
      type="button"
      style={disabled ? submenuItemDisabledStyle : submenuItemStyle}
      onClick={() => {
        if (disabled) return;
        onSectionBreak?.(breakType);
        closeMenu();
      }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseOver={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            'var(--doc-hover, #f3f4f6)';
        }
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export function BreaksDropdown({ disabled, onPageBreak, onSectionBreak }: BreaksDropdownProps) {
  const isPageBreakDisabled = disabled || !onPageBreak;
  const isSectionBreakDisabled = disabled || !onSectionBreak;

  const items: MenuEntry[] = [
    {
      icon: 'page_break',
      label: 'Page Break',
      onClick: onPageBreak,
      disabled: isPageBreakDisabled,
    },
    { type: 'separator' },
    {
      icon: 'view_column',
      label: 'Column Break',
      disabled: true,
    },
    {
      icon: 'format_textdirection_l_to_r',
      label: 'Text Wrapping',
      disabled: true,
    },
    { type: 'separator' },
    {
      label: 'Section Breaks',
      disabled: isSectionBreakDisabled,
      submenuContent: isSectionBreakDisabled
        ? undefined
        : (closeMenu) => (
            <div style={submenuListStyle}>
              {createSubmenuItem('Next Page', 'nextPage', {
                disabled: isSectionBreakDisabled,
                onSectionBreak,
                closeMenu,
              })}
              {createSubmenuItem('Continuous', 'continuous', {
                disabled: isSectionBreakDisabled,
                onSectionBreak,
                closeMenu,
              })}
              {createSubmenuItem('Even Page', 'evenPage', {
                disabled: isSectionBreakDisabled,
                onSectionBreak,
                closeMenu,
              })}
              {createSubmenuItem('Odd Page', 'oddPage', {
                disabled: isSectionBreakDisabled,
                onSectionBreak,
                closeMenu,
              })}
            </div>
          ),
    },
  ];

  const menuDisabled = disabled || (!onPageBreak && !onSectionBreak);

  return <MenuDropdown label="Breaks" items={items} disabled={menuDisabled} />;
}
