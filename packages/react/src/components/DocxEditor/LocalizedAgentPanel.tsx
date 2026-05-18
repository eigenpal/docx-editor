import { AgentPanel } from '@eigenpal/docx-editor-agents/react';
import { useTranslation } from '../../i18n';
import type { AgentPanelOptions } from './types';

/**
 * Inner wrapper that calls `useTranslation` to forward localised labels
 * down to AgentPanel. Lives below the LocaleProvider so the context is
 * resolved.
 */
export function LocalizedAgentPanel({
  agentPanel,
  closed,
  onClose,
}: {
  agentPanel: AgentPanelOptions;
  closed: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AgentPanel
      title={agentPanel.title ?? t('agentPanel.defaultTitle')}
      icon={agentPanel.icon}
      closeLabel={t('agentPanel.close')}
      resizeHandleLabel={t('agentPanel.resizeHandle')}
      defaultWidth={agentPanel.defaultWidth}
      minWidth={agentPanel.minWidth}
      maxWidth={agentPanel.maxWidth}
      onClose={onClose}
      closed={closed}
    >
      {agentPanel.render({ close: onClose })}
    </AgentPanel>
  );
}
