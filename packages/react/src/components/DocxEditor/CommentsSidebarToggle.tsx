import { useTranslation } from '../../i18n';
import { ToolbarButton } from '../Toolbar';
import { MaterialSymbol } from '../ui/Icons';

/**
 * Wrapper for the comments-sidebar toggle so the button title runs through
 * `t()` — `useTranslation()` only works for components rendered *inside*
 * `<LocaleProvider>`, which `DocxEditor`'s own body is not.
 */
export function CommentsSidebarToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const title = t('editor.toggleCommentsSidebar');
  return (
    <ToolbarButton onClick={onClick} active={active} title={title} ariaLabel={title}>
      <MaterialSymbol name="comment" size={20} />
    </ToolbarButton>
  );
}
