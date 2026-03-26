import type { SectionProperties, PageOrientation } from '@eigenpal/docx-core/types/document';

const TOLERANCE_TWIPS = 20;

const DEFAULT_PAGE_WIDTH = 12240; // Letter
const DEFAULT_PAGE_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

export const PAGE_SIZE_PRESETS = [
  { id: 'letter', label: 'Letter (8.5" × 11")', width: 12240, height: 15840 },
  { id: 'a4', label: 'A4 (8.27" × 11.69")', width: 11906, height: 16838 },
  { id: 'legal', label: 'Legal (8.5" × 14")', width: 12240, height: 20160 },
  { id: 'a3', label: 'A3 (11.69" × 16.54")', width: 16838, height: 23811 },
  { id: 'a5', label: 'A5 (5.83" × 8.27")', width: 8391, height: 11906 },
  { id: 'b5', label: 'B5 (6.93" × 9.84")', width: 9979, height: 14175 },
  { id: 'executive', label: 'Executive (7.25" × 10.5")', width: 10440, height: 15120 },
] as const;

export const MARGIN_PRESETS = [
  { id: 'normal', label: 'Normal', top: 1440, bottom: 1440, left: 1440, right: 1440 },
  { id: 'narrow', label: 'Narrow', top: 720, bottom: 720, left: 720, right: 720 },
  { id: 'moderate', label: 'Moderate', top: 1080, bottom: 1080, left: 1260, right: 1260 },
  { id: 'wide', label: 'Wide', top: 1440, bottom: 1440, left: 2880, right: 2880 },
  { id: 'mirrored', label: 'Mirrored', top: 1440, bottom: 1440, left: 1440, right: 1440 },
] as const;

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE_TWIPS;
}

function getEffectivePageSize(props?: SectionProperties | null) {
  return {
    width: props?.pageWidth ?? DEFAULT_PAGE_WIDTH,
    height: props?.pageHeight ?? DEFAULT_PAGE_HEIGHT,
  };
}

export function getOrientation(props?: SectionProperties | null): PageOrientation {
  if (props?.orientation) return props.orientation;
  const { width, height } = getEffectivePageSize(props);
  return width > height ? 'landscape' : 'portrait';
}

export function getPageSizePresetId(props?: SectionProperties | null): string | 'custom' {
  const { width, height } = getEffectivePageSize(props);
  const w = Math.min(width, height);
  const h = Math.max(width, height);
  const match = PAGE_SIZE_PRESETS.find((p) => isClose(p.width, w) && isClose(p.height, h));
  return match?.id ?? 'custom';
}

export function getMarginPresetId(props?: SectionProperties | null): string | 'custom' {
  const top = props?.marginTop ?? DEFAULT_MARGIN;
  const bottom = props?.marginBottom ?? DEFAULT_MARGIN;
  const left = props?.marginLeft ?? DEFAULT_MARGIN;
  const right = props?.marginRight ?? DEFAULT_MARGIN;
  const match = MARGIN_PRESETS.find(
    (p) => isClose(p.top, top) && isClose(p.bottom, bottom) && isClose(p.left, left) && isClose(p.right, right)
  );
  return match?.id ?? 'custom';
}

export function buildMarginProps(presetId: string): Partial<SectionProperties> {
  const preset = MARGIN_PRESETS.find((p) => p.id === presetId) ?? MARGIN_PRESETS[0];
  return {
    marginTop: preset.top,
    marginBottom: preset.bottom,
    marginLeft: preset.left,
    marginRight: preset.right,
  };
}

export function buildOrientationProps(
  orientation: PageOrientation,
  current?: SectionProperties | null
): Partial<SectionProperties> {
  const { width, height } = getEffectivePageSize(current);
  const isLandscape = orientation === 'landscape';
  const nextWidth = isLandscape ? Math.max(width, height) : Math.min(width, height);
  const nextHeight = isLandscape ? Math.min(width, height) : Math.max(width, height);
  return { orientation, pageWidth: nextWidth, pageHeight: nextHeight };
}

export function buildPageSizeProps(
  presetId: string,
  current?: SectionProperties | null
): Partial<SectionProperties> {
  const preset = PAGE_SIZE_PRESETS.find((p) => p.id === presetId) ?? PAGE_SIZE_PRESETS[0];
  const orientation = getOrientation(current);
  if (orientation === 'landscape') {
    return { pageWidth: preset.height, pageHeight: preset.width, orientation };
  }
  return { pageWidth: preset.width, pageHeight: preset.height, orientation };
}
