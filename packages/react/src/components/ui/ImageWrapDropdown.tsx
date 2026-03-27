/**
 * Image Wrap Dropdown — thin wrapper around IconGridDropdown.
 */

import { IconGridDropdown, type IconGridOption } from './IconGridDropdown';
import { useTranslation } from '../../i18n';

const WRAP_OPTIONS: (Omit<IconGridOption, 'label'> & { labelKey: string })[] = [
  { value: 'inline', labelKey: 'imageWrap.inline', iconName: 'format_image_left' },
  { value: 'wrapRight', labelKey: 'imageWrap.floatLeft', iconName: 'format_image_right' },
  { value: 'wrapLeft', labelKey: 'imageWrap.floatRight', iconName: 'format_image_left' },
  { value: 'topAndBottom', labelKey: 'imageWrap.topAndBottom', iconName: 'horizontal_rule' },
  { value: 'behind', labelKey: 'imageWrap.behindText', iconName: 'flip_to_back' },
  { value: 'inFront', labelKey: 'imageWrap.inFrontOfText', iconName: 'flip_to_front' },
];

export interface ImageWrapDropdownProps {
  imageContext: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  };
  onChange: (wrapType: string) => void;
  disabled?: boolean;
}

function getActiveWrapValue(ctx: ImageWrapDropdownProps['imageContext']): string {
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'left') return 'wrapRight';
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'right') return 'wrapLeft';
  return ctx.wrapType;
}

export function ImageWrapDropdown({
  imageContext,
  onChange,
  disabled = false,
}: ImageWrapDropdownProps) {
  const { t } = useTranslation();
  const translatedOptions: IconGridOption[] = WRAP_OPTIONS.map((opt) => ({
    ...opt,
    label: t(opt.labelKey as any),
  }));

  const activeValue = getActiveWrapValue(imageContext);
  const currentOption =
    translatedOptions.find((o) => o.value === activeValue) || translatedOptions[0];

  return (
    <IconGridDropdown
      options={translatedOptions}
      activeValue={activeValue}
      triggerIcon={currentOption.iconName}
      tooltipContent={`Wrap: ${currentOption.label}`}
      onSelect={onChange}
      disabled={disabled}
      testId="toolbar-image-wrap"
    />
  );
}
