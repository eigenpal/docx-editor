import type { ReactNode } from 'react';

/**
 * Options for the agent panel mount on the right side of the editor.
 *
 * Three control patterns:
 *  - **Uncontrolled**: `agentPanel={{ render }}` — toolbar button + panel
 *    close button toggle the panel. Width persists to localStorage.
 *  - **Controlled**: `agentPanel={{ render, open, onOpenChange }}` — the
 *    consumer owns open state (e.g. tied to a global menu).
 *  - **Headless**: omit `agentPanel`, use the toolkit directly via
 *    `useDocxAgentTools` — render the panel anywhere you want.
 */
export interface AgentPanelOptions {
  /** Render-prop returning the panel content. Called only when open. */
  render: (ctx: { close: () => void }) => ReactNode;
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  /** Fires when toolbar button or panel close button is clicked. */
  onOpenChange?: (open: boolean) => void;
  /** Show the toolbar toggle button. Default: true. */
  showToolbarButton?: boolean;
  /** Optional badge / dot on the toolbar button. */
  toolbarBadge?: ReactNode;
  /** Optional panel title. Default: t('agentPanel.defaultTitle'). */
  title?: string;
  /** Optional panel header icon. Default: sparkle. */
  icon?: ReactNode;
  /** Initial panel width in px (uncontrolled). Default: 360. */
  defaultWidth?: number;
  /** Min drag width. Default: 280. */
  minWidth?: number;
  /** Max drag width. Default: 600. */
  maxWidth?: number;
}
