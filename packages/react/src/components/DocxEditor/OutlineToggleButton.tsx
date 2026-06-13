import { useTranslation } from '../../i18n';
import { Z_INDEX } from '../../styles/zIndex';
import { OUTLINE_BUTTON_LEFT_OFFSET } from '../DocumentOutline';
import { MaterialSymbol } from '../ui/Icons';

/**
 * Outline toggle — same reason as `CommentsSidebarToggle`: needs to render
 * inside `<LocaleProvider>` to see the user's `i18n` prop.
 */
export function OutlineToggleButton({
  onClick,
  topPx,
  scrollLeft = 0,
}: {
  onClick: () => void;
  topPx: number;
  /** Horizontal scroll offset of the editor — button slides with the doc. */
  scrollLeft?: number;
}) {
  const { t } = useTranslation();
  return (
    <button
      className="docx-outline-nav"
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={t('editor.showDocumentOutline')}
      style={{
        position: 'absolute',
        // Anchor at the page's top-left and track horizontal scroll so the
        // button doesn't pin to the viewport and overlay the doc.
        left: OUTLINE_BUTTON_LEFT_OFFSET - scrollLeft,
        top: topPx,
        zIndex: Z_INDEX.outline,
        background: 'transparent',
        border: 'none',
        borderRadius: '50%',
        padding: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <MaterialSymbol name="format_list_bulleted" size={20} style={{ color: '#444746' }} />
    </button>
  );
}
