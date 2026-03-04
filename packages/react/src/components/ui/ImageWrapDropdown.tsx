/**
 * Image Wrap Dropdown — thin wrapper around IconGridDropdown.
 */

import { IconGridDropdown, type IconGridOption } from './IconGridDropdown';

const WRAP_OPTIONS: IconGridOption[] = [
  { value: 'inline', label: 'Inline with text', iconName: 'format_image_left' },
  { value: 'wrapRight', label: 'Float left (wrap right)', iconName: 'format_image_right' },
  { value: 'wrapLeft', label: 'Float right (wrap left)', iconName: 'format_image_left' },
  { value: 'topAndBottom', label: 'Top and bottom', iconName: 'horizontal_rule' },
  { value: 'behind', label: 'Behind text', iconName: 'flip_to_back' },
  { value: 'inFront', label: 'In front of text', iconName: 'flip_to_front' },
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
  const activeValue = getActiveWrapValue(imageContext);
  const currentOption = WRAP_OPTIONS.find((o) => o.value === activeValue) || WRAP_OPTIONS[0];

  return (
    <IconGridDropdown
      options={WRAP_OPTIONS}
      activeValue={activeValue}
      triggerIcon={currentOption.iconName}
      tooltipContent={`Wrap: ${currentOption.label}`}
      onSelect={onChange}
      disabled={disabled}
      testId="toolbar-image-wrap"
    />
  );
}
