import { defineComponent, ref, watch, type CSSProperties, type PropType } from 'vue';
import { useTranslation } from '../i18n';
import { usePageSetup } from './usePageSetup';

const PAGE_SIZES = [
  { labelKey: 'dialogs.pageSetup.pageSizes.letter' as const, width: 12240, height: 15840 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a4' as const, width: 11906, height: 16838 },
  { labelKey: 'dialogs.pageSetup.pageSizes.legal' as const, width: 12240, height: 20160 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a3' as const, width: 16838, height: 23811 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a5' as const, width: 8391, height: 11906 },
  { labelKey: 'dialogs.pageSetup.pageSizes.b5' as const, width: 9979, height: 14175 },
  { labelKey: 'dialogs.pageSetup.pageSizes.executive' as const, width: 10440, height: 15120 },
] as const;

const TWIPS_PER_INCH = 1440;
const DEFAULT_WIDTH = 12240;
const DEFAULT_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

const twipsToInches = (twips: number): number => Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
const inchesToTwips = (inches: number): number => Math.round(inches * TWIPS_PER_INCH);

function findPageSizeIndex(w: number, h: number): number {
  const pw = Math.min(w, h);
  const ph = Math.max(w, h);
  return PAGE_SIZES.findIndex(
    (size) => Math.abs(size.width - pw) < 20 && Math.abs(size.height - ph) < 20
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--doc-overlay)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const dialogStyle: CSSProperties = {
  backgroundColor: 'var(--doc-surface)',
  borderRadius: 8,
  boxShadow: '0 4px 20px var(--doc-shadow)',
  minWidth: 400,
  maxWidth: 480,
  width: '100%',
  margin: 20,
};

/** @public */
export interface DocxEditorPageSetupDialogProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

/** @public */
export const DocxEditorPageSetupDialog = defineComponent({
  name: 'DocxEditorPageSetupDialog',
  props: {
    open: { type: Boolean, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const setup = usePageSetup();
    const pageWidth = ref(DEFAULT_WIDTH);
    const pageHeight = ref(DEFAULT_HEIGHT);
    const orientation = ref<'portrait' | 'landscape'>('portrait');
    const marginTop = ref(DEFAULT_MARGIN);
    const marginBottom = ref(DEFAULT_MARGIN);
    const marginLeft = ref(DEFAULT_MARGIN);
    const marginRight = ref(DEFAULT_MARGIN);
    const scope = ref<'document' | 'section'>('document');
    const panelRef = ref<HTMLDivElement | null>(null);
    const seeded = ref<'no' | 'loading' | 'yes'>('no');

    watch(
      [() => props.open, () => setup.pageSetup.value],
      ([open]) => {
        if (!open) {
          seeded.value = 'no';
          return;
        }
        const ps = setup.pageSetup.value;
        if (seeded.value === 'yes' && ps === null) {
          seeded.value = 'no';
          return;
        }
        if (seeded.value === 'yes' || (seeded.value === 'loading' && ps === null)) return;
        pageWidth.value = ps?.pageWidthTwips ?? DEFAULT_WIDTH;
        pageHeight.value = ps?.pageHeightTwips ?? DEFAULT_HEIGHT;
        orientation.value = ps?.orientation ?? 'portrait';
        marginTop.value = ps?.marginsTwips.top ?? DEFAULT_MARGIN;
        marginBottom.value = ps?.marginsTwips.bottom ?? DEFAULT_MARGIN;
        marginLeft.value = ps?.marginsTwips.left ?? DEFAULT_MARGIN;
        marginRight.value = ps?.marginsTwips.right ?? DEFAULT_MARGIN;
        scope.value = 'document';
        seeded.value = ps === null ? 'loading' : 'yes';
      },
      { flush: 'post' }
    );

    watch(
      () => props.open,
      (open) => {
        if (open) panelRef.value?.focus();
      },
      { flush: 'post' }
    );

    const handlePageSizeChange = (index: number) => {
      const size = PAGE_SIZES[index];
      if (!size) return;
      pageWidth.value = orientation.value === 'landscape' ? size.height : size.width;
      pageHeight.value = orientation.value === 'landscape' ? size.width : size.height;
    };

    const handleOrientationChange = (next: 'portrait' | 'landscape') => {
      if (next === orientation.value) return;
      const w = pageWidth.value;
      const h = pageHeight.value;
      orientation.value = next;
      pageWidth.value = h;
      pageHeight.value = w;
    };

    const handleApply = () => {
      const accepted = setup.apply({
        pageWidthTwips: pageWidth.value,
        pageHeightTwips: pageHeight.value,
        orientation: orientation.value,
        marginTopTwips: marginTop.value,
        marginRightTwips: marginRight.value,
        marginBottomTwips: marginBottom.value,
        marginLeftTwips: marginLeft.value,
        scope: scope.value,
      });
      if (accepted) props.onClose();
    };

    return () => {
      if (!props.open) return null;
      const sizeIndex = findPageSizeIndex(pageWidth.value, pageHeight.value);
      const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
      const labelStyle: CSSProperties = { width: 80, fontSize: 13, color: 'var(--doc-text-muted)' };
      const inputStyle: CSSProperties = {
        flex: 1,
        padding: '6px 8px',
        border: '1px solid var(--doc-border)',
        borderRadius: 4,
        fontSize: 13,
        backgroundColor: 'var(--doc-surface)',
        color: 'var(--doc-text)',
      };

      const marginRow = (
        labelKey: 'top' | 'bottom' | 'left' | 'right',
        value: number,
        set: (twips: number) => void
      ) => (
        <div style={rowStyle}>
          <label style={labelStyle}>{t.value(`dialogs.pageSetup.${labelKey}`)}</label>
          <input
            type="number"
            style={inputStyle}
            min={0}
            max={22}
            step={0.1}
            value={twipsToInches(value)}
            onInput={(event) =>
              set(Math.max(0, inchesToTwips(Number((event.target as HTMLInputElement).value) || 0)))
            }
            aria-label={t.value(`dialogs.pageSetup.${labelKey}`)}
          />
          <span style={{ fontSize: 11, color: 'var(--doc-text-muted)', width: 16 }}>in</span>
        </div>
      );

      return (
        <div
          class={props.className}
          style={overlayStyle}
          onClick={props.onClose}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose();
            if (event.key === 'Enter') handleApply();
          }}
        >
          <div
            ref={panelRef}
            tabindex={-1}
            style={dialogStyle}
            onClick={(event) => event.stopPropagation()}
            onMousedown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.value('dialogs.pageSetup.title')}
          >
            <div
              style={{
                padding: '16px 20px 12px',
                borderBottom: '1px solid var(--doc-border)',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--doc-text)',
              }}
            >
              {t.value('dialogs.pageSetup.title')}
            </div>
            <div
              style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--doc-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {t.value('dialogs.pageSetup.pageSize')}
              </div>
              <div style={rowStyle}>
                <label style={labelStyle}>{t.value('dialogs.pageSetup.sizeLabel')}</label>
                <select
                  style={inputStyle}
                  value={sizeIndex}
                  onChange={(event) =>
                    handlePageSizeChange(Number((event.target as HTMLSelectElement).value))
                  }
                  aria-label={t.value('dialogs.pageSetup.sizeLabel')}
                >
                  {PAGE_SIZES.map((size, index) => (
                    <option key={size.labelKey} value={index}>
                      {t.value(size.labelKey)}
                    </option>
                  ))}
                  {sizeIndex < 0 && (
                    <option value={-1}>{t.value('dialogs.pageSetup.custom')}</option>
                  )}
                </select>
              </div>
              <div style={rowStyle}>
                <label style={labelStyle}>{t.value('dialogs.pageSetup.orientation')}</label>
                <select
                  style={inputStyle}
                  value={orientation.value}
                  onChange={(event) =>
                    handleOrientationChange(
                      (event.target as HTMLSelectElement).value as 'portrait' | 'landscape'
                    )
                  }
                  aria-label={t.value('dialogs.pageSetup.orientation')}
                >
                  <option value="portrait">{t.value('dialogs.pageSetup.portrait')}</option>
                  <option value="landscape">{t.value('dialogs.pageSetup.landscape')}</option>
                </select>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--doc-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginTop: 4,
                }}
              >
                {t.value('dialogs.pageSetup.margins')}
              </div>
              {marginRow('top', marginTop.value, (v) => {
                marginTop.value = v;
              })}
              {marginRow('bottom', marginBottom.value, (v) => {
                marginBottom.value = v;
              })}
              {marginRow('left', marginLeft.value, (v) => {
                marginLeft.value = v;
              })}
              {marginRow('right', marginRight.value, (v) => {
                marginRight.value = v;
              })}
              <div style={rowStyle}>
                <label style={labelStyle}>{t.value('dialogs.pageSetup.applyTo')}</label>
                <select
                  style={inputStyle}
                  value={scope.value}
                  onChange={(event) => {
                    scope.value = (event.target as HTMLSelectElement).value as
                      | 'document'
                      | 'section';
                  }}
                  aria-label={t.value('dialogs.pageSetup.applyTo')}
                >
                  <option value="document">{t.value('dialogs.pageSetup.applyToDocument')}</option>
                  <option value="section">{t.value('dialogs.pageSetup.applyToSection')}</option>
                </select>
              </div>
            </div>
            <div
              style={{
                padding: '12px 20px 16px',
                borderTop: '1px solid var(--doc-border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button
                type="button"
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  border: '1px solid var(--doc-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: 'var(--doc-surface)',
                  color: 'var(--doc-text)',
                }}
                onClick={props.onClose}
              >
                {t.value('common.cancel')}
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  border: '1px solid var(--doc-primary)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: 'var(--doc-primary)',
                  color: 'var(--doc-on-primary)',
                  opacity: setup.isEnabled.value ? 1 : 0.5,
                }}
                disabled={!setup.isEnabled.value}
                onClick={handleApply}
              >
                {t.value('common.apply')}
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
});
