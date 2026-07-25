// `AgentPanel` lives in `@docx-editor.dev/agents/react`, which exists in this repo
// (`packages/agents/src/react.ts:39`) but does not resolve from here: the workspace link
// is not created for it. Rather than fabricate a panel, this renders NOTHING and keeps
// the shell's slot intact, so wiring the dependency later restores the real component
// with no change to the call site. A stub must not pretend the capability is present.
const AgentPanel = (_props: Record<string, unknown> & { children?: React.ReactNode }) => null;
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
