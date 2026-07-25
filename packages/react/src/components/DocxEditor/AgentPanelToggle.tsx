import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { ToolbarButton } from '../Toolbar';
import { MaterialSymbol } from '../ui/Icons';

export function AgentPanelToggle({
  active,
  onClick,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
}) {
  const { t } = useTranslation();
  const title = t('agentPanel.toggle');
  return (
    <ToolbarButton onClick={onClick} active={active} title={title} ariaLabel={title}>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <MaterialSymbol name="agent-sparkle" size={20} />
        {badge != null && (
          <span
            data-testid="agent-panel-toggle-badge"
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              borderRadius: 7,
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--doc-error)',
              color: 'var(--doc-on-primary)',
              lineHeight: 1,
            }}
          >
            {badge}
          </span>
        )}
      </span>
    </ToolbarButton>
  );
}
