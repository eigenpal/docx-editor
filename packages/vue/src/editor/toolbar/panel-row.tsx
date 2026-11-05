import type { VNodeChild } from 'vue';
import { useToolbarPlacement } from './ToolbarGroup';

/**
 * Whether a toolbar part draws its trigger as a "⋯" panel row: it renders in the panel and
 * shows its own default content. In the panel, a lone icon button beside a plain-text label
 * reads as disabled and leaves most of the row inert, so the whole row is the button. Call in
 * `setup`; the returned check runs at render time.
 */
export function usePanelRow(): (asChild: boolean | undefined, hasChildren: boolean) => boolean {
  const placement = useToolbarPlacement();
  return (asChild, hasChildren) => placement === 'panel' && !asChild && !hasChildren;
}

/** The trigger class for a part, in the bar or as a panel row. */
export function triggerClassName(panelRow: boolean): string {
  return panelRow ? 'docx-toolbar__more-command' : 'docx-toolbar__button';
}

/** A panel row's content: the icon and label the panel's command rows show. */
export function panelRowContent(icon: VNodeChild, label: string): VNodeChild {
  return (
    <>
      <span class="docx-toolbar__more-command-icon" aria-hidden="true">
        {icon}
      </span>
      <span class="docx-toolbar__more-command-label">{label}</span>
    </>
  );
}
