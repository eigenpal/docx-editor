import type { SectionProperties } from '@eigenpal/docx-core/types/document';
import type { MenuEntry } from './MenuDropdown';
import { MenuDropdown } from './MenuDropdown';
import {
  PAGE_SIZE_PRESETS,
  MARGIN_PRESETS,
  getMarginPresetId,
  getPageSizePresetId,
  getOrientation,
  buildMarginProps,
  buildPageSizeProps,
  buildOrientationProps,
} from './pageSetupPresets';
import { MaterialSymbol } from './MaterialSymbol';

export type PageSetupDropdownKind = 'margins' | 'orientation' | 'size';

export function PageSetupDropdown({
  kind,
  sectionProperties,
  onApply,
  onOpenDialog,
  disabled,
  testId,
}: {
  kind: PageSetupDropdownKind;
  sectionProperties?: SectionProperties | null;
  onApply?: (props: Partial<SectionProperties>) => void;
  onOpenDialog?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const triggerLabel = kind === 'margins' ? 'Margins' : kind === 'orientation' ? 'Orientation' : 'Size';
  const activeMargin = getMarginPresetId(sectionProperties);
  const activeSize = getPageSizePresetId(sectionProperties);
  const activeOrientation = getOrientation(sectionProperties);
  const applyDisabled = disabled || !onApply;
  const dialogDisabled = disabled || !onOpenDialog;

  const items: MenuEntry[] =
    kind === 'margins'
      ? [
          ...MARGIN_PRESETS.map((preset) => ({
            label: preset.label,
            checked: activeMargin === preset.id,
            onClick: () => onApply?.(buildMarginProps(preset.id)),
            disabled: applyDisabled,
          })),
          { type: 'separator' as const },
          {
            label: 'Custom Margins...',
            checked: activeMargin === 'custom',
            onClick: onOpenDialog,
            disabled: dialogDisabled,
          },
        ]
      : kind === 'orientation'
      ? [
          {
            label: 'Portrait',
            checked: activeOrientation === 'portrait',
            onClick: () => onApply?.(buildOrientationProps('portrait', sectionProperties)),
            disabled: applyDisabled,
          },
          {
            label: 'Landscape',
            checked: activeOrientation === 'landscape',
            onClick: () => onApply?.(buildOrientationProps('landscape', sectionProperties)),
            disabled: applyDisabled,
          },
          { type: 'separator' as const },
          {
            label: 'Page Setup...',
            onClick: onOpenDialog,
            disabled: dialogDisabled,
          },
        ]
      : [
          ...PAGE_SIZE_PRESETS.map((preset) => ({
            label: preset.label,
            checked: activeSize === preset.id,
            onClick: () => onApply?.(buildPageSizeProps(preset.id, sectionProperties)),
            disabled: applyDisabled,
          })),
          { type: 'separator' as const },
          {
            label: 'More Paper Sizes...',
            checked: activeSize === 'custom',
            onClick: onOpenDialog,
            disabled: dialogDisabled,
          },
        ];

  const iconName = kind === 'margins' ? 'padding' : kind === 'orientation' ? 'swap_horiz' : 'fit_width';

  return (
    <MenuDropdown
      label={triggerLabel}
      items={items}
      disabled={disabled || (!onApply && !onOpenDialog)}
      testId={testId}
      triggerClassName="ribbon__button ribbon__button--menu"
      triggerContent={
        <span className="ribbon__button-content">
          <MaterialSymbol name={iconName} size={16} />
          <span>{triggerLabel}</span>
        </span>
      }
      showCaret
      menuWidth={220}
    />
  );
}
