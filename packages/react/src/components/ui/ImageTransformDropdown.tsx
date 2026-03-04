/**
 * Image Transform Dropdown — thin wrapper around IconGridDropdown.
 */

import { IconGridDropdown, type IconGridOption } from './IconGridDropdown';

type TransformAction = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

const TRANSFORM_OPTIONS: IconGridOption<TransformAction>[] = [
  { value: 'rotateCW', label: 'Rotate clockwise', iconName: 'rotate_right' },
  { value: 'rotateCCW', label: 'Rotate counter-clockwise', iconName: 'rotate_left' },
  { value: 'flipH', label: 'Flip horizontal', iconName: 'swap_horiz' },
  { value: 'flipV', label: 'Flip vertical', iconName: 'swap_vert' },
];

export interface ImageTransformDropdownProps {
  onTransform: (action: TransformAction) => void;
  disabled?: boolean;
}

export function ImageTransformDropdown({
  onTransform,
  disabled = false,
}: ImageTransformDropdownProps) {
  return (
    <IconGridDropdown<TransformAction>
      options={TRANSFORM_OPTIONS}
      triggerIcon="rotate_right"
      tooltipContent="Transform"
      onSelect={onTransform}
      disabled={disabled}
      testId="toolbar-image-transform"
    />
  );
}
