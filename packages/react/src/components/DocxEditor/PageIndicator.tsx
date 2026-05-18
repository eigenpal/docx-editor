import { useTranslation } from '../../i18n';

/**
 * Floating page indicator shown next to the scrollbar while the user
 * scrolls a multi-page document. Wrapped so the `{current} of {total}`
 * template runs through `t()`; `useTranslation()` only works inside
 * `<LocaleProvider>`, which `DocxEditor`'s own body is not.
 */
export function PageIndicator({
  currentPage,
  totalPages,
  visible,
}: {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        top: '50%',
        transform: 'translateY(-50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '6px 12px',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 1000,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        userSelect: 'none',
      }}
      aria-live="polite"
      role="status"
    >
      {t('viewer.pageIndicator', { current: currentPage, total: totalPages })}
    </div>
  );
}
