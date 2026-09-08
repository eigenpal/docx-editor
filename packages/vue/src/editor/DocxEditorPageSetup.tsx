import type { DocxEditorChildren } from '../docx-editor-children';
import {
  Fragment,
  computed,
  cloneVNode,
  defineComponent,
  ref,
  watch,
  type CSSProperties,
  type PropType,
} from 'vue';
import {
  createDialogComposition,
  NativeDialog,
  useDialogGeneration,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
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

/** Page Setup draft values in twips. @public */
export interface PageSetupDialogFields {
  pageWidth: number;
  pageHeight: number;
  orientation: 'portrait' | 'landscape';
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  scope: 'document' | 'section';
}
/** Page Setup draft state and actions. @public */
export interface UsePageSetupDialogReturn extends UseDialogReturn<PageSetupDialogFields> {}
const composition = createDialogComposition<
  PageSetupDialogFields,
  Exclude<keyof PageSetupDialogFields, 'pageWidth' | 'pageHeight'> | 'pageSize'
>('PageSetupDialog');
/** Access the current Page Setup draft and actions. @public */
export function usePageSetupDialog(): UsePageSetupDialogReturn {
  return composition.useContext();
}

/** @public */
export interface DocxEditorPageSetupDialogProps extends DialogCustomizationProps {
  open: boolean;
  onClose: () => void;
}

/** @public */
const PageSetupDialogImpl = defineComponent({
  name: 'DocxEditorPageSetupDialog',
  props: {
    children: Object as PropType<DocxEditorChildren>,
    open: { type: Boolean, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    className: { type: String, default: undefined },
    style: Object as PropType<CSSProperties>,
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const currentGeneration = useDialogGeneration(() => props.open, props.onClose);
    const setup = usePageSetup();
    const pageWidth = ref(DEFAULT_WIDTH);
    const pageHeight = ref(DEFAULT_HEIGHT);
    const orientation = ref<'portrait' | 'landscape'>('portrait');
    const marginTop = ref(DEFAULT_MARGIN);
    const marginBottom = ref(DEFAULT_MARGIN);
    const marginLeft = ref(DEFAULT_MARGIN);
    const marginRight = ref(DEFAULT_MARGIN);
    const scope = ref<'document' | 'section'>('document');
    const refused = ref(false);
    const seeded = ref<'no' | 'loading' | 'yes'>('no');

    watch(
      [() => props.open, () => setup.pageSetup.value],
      ([open]) => {
        if (!open) {
          refused.value = false;
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
      { flush: 'post', immediate: true }
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
      if (!currentGeneration()) return;
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
      refused.value = !accepted;
      if (accepted) props.onClose();
    };

    const fields = {
      pageWidth,
      pageHeight,
      orientation,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      scope,
    };
    const renderParts = composition.provideContext({
      values: computed(
        () =>
          ({
            ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value])),
          }) as unknown as PageSetupDialogFields
      ),
      errors: computed(() => (refused.value ? { form: t('dialogs.paragraph.refused') } : {})),
      isEnabled: setup.isEnabled,
      setValue: (name, value) => {
        if (name === 'orientation') handleOrientationChange(value as 'portrait' | 'landscape');
        else (fields[name as keyof typeof fields] as { value: unknown }).value = value;
      },
      apply: handleApply,
      cancel: props.onClose,
    });
    return () => {
      if (!props.open) return null;
      const sizeIndex = findPageSizeIndex(pageWidth.value, pageHeight.value);
      const field = (name: string, label: string, input: import('vue').VNode) => (
        <label data-docx-part="field" data-docx-field={name} class="docx-dialog__row">
          <span class="docx-dialog__label">{label}</span>
          {cloneVNode(input, { 'aria-label': label })}
          {name.startsWith('margin') ? <span class="docx-dialog__unit">in</span> : null}
        </label>
      );
      const margins = ['top', 'bottom', 'left', 'right'] as const;
      const defaults = (
        <Fragment>
          <div data-docx-part="header" class="docx-dialog__header">
            <span data-docx-part="title" class="docx-dialog__title">
              {t('dialogs.pageSetup.title')}
            </span>
          </div>
          <div data-docx-part="body" class="docx-dialog__body">
            <div class="docx-dialog__section-label">{t('dialogs.pageSetup.pageSize')}</div>
            {field(
              'pageSize',
              t('dialogs.pageSetup.sizeLabel'),
              <select
                class="docx-dialog__input"
                value={sizeIndex}
                onChange={(e) =>
                  handlePageSizeChange(Number((e.target as HTMLSelectElement).value))
                }
              >
                {PAGE_SIZES.map((size, i) => (
                  <option value={i}>{t(size.labelKey)}</option>
                ))}
                {sizeIndex < 0 ? <option value={-1}>{t('dialogs.pageSetup.custom')}</option> : null}
              </select>
            )}
            {field(
              'orientation',
              t('dialogs.pageSetup.orientation'),
              <select
                class="docx-dialog__input"
                value={orientation.value}
                onChange={(e) =>
                  handleOrientationChange(
                    (e.target as HTMLSelectElement).value as 'portrait' | 'landscape'
                  )
                }
              >
                <option value="portrait">{t('dialogs.pageSetup.portrait')}</option>
                <option value="landscape">{t('dialogs.pageSetup.landscape')}</option>
              </select>
            )}
            <div class="docx-dialog__section-label docx-dialog__section-label--spaced">
              {t('dialogs.pageSetup.margins')}
            </div>
            {margins.map((side) => {
              const name = `margin${side[0].toUpperCase()}${side.slice(1)}` as
                | 'marginTop'
                | 'marginBottom'
                | 'marginLeft'
                | 'marginRight';
              return field(
                name,
                t(`dialogs.pageSetup.${side}`),
                <input
                  class="docx-dialog__input"
                  type="number"
                  min={0}
                  max={22}
                  step={0.1}
                  value={twipsToInches(fields[name].value)}
                  onInput={(e) => {
                    fields[name].value = Math.max(
                      0,
                      inchesToTwips(Number((e.target as HTMLInputElement).value) || 0)
                    );
                  }}
                />
              );
            })}
            {field(
              'scope',
              t('dialogs.pageSetup.applyTo'),
              <select
                class="docx-dialog__input"
                value={scope.value}
                onChange={(e) => {
                  scope.value = (e.target as HTMLSelectElement).value as 'document' | 'section';
                }}
              >
                <option value="document">{t('dialogs.pageSetup.applyToDocument')}</option>
                <option value="section">{t('dialogs.pageSetup.applyToSection')}</option>
              </select>
            )}
          </div>
          <div data-docx-part="footer" class="docx-dialog__footer">
            <span data-docx-part="error" class="docx-dialog__error" role="alert">
              {refused.value ? t('dialogs.paragraph.refused') : null}
            </span>
            <button
              data-docx-part="cancel"
              class="docx-dialog__button docx-dialog__cancel"
              type="button"
              onClick={props.onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              data-docx-part="apply"
              class="docx-dialog__button docx-dialog__apply"
              type="button"
              disabled={!setup.isEnabled.value}
              onClick={handleApply}
            >
              {t('common.apply')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="pageSetup"
          label={t('dialogs.pageSetup.title')}
          onClose={props.onClose}
          class={props.className}
          style={props.style}
          onKeydown={(event: KeyboardEvent) => {
            if (
              event.key === 'Enter' &&
              !event.isComposing &&
              !(event.target instanceof HTMLButtonElement) &&
              !(event.target instanceof HTMLSelectElement) &&
              setup.isEnabled.value
            ) {
              event.preventDefault();
              handleApply();
            }
          }}
          content={() =>
            renderParts(
              defaults,
              slots.default?.() ?? (props.children ? [props.children] : []),
              props.preset
            )
          }
        />
      );
    };
  },
});
/** Customizable Page Setup dialog. @public */
export const DocxEditorPageSetupDialog = Object.assign(PageSetupDialogImpl, composition.parts);
