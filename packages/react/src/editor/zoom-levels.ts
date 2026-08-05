export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function stepZoomLevel(zoom: number, direction: 'in' | 'out'): number | null {
  const epsilon = 0.001;
  return direction === 'in'
    ? (ZOOM_LEVELS.find((level) => level > zoom + epsilon) ?? null)
    : ([...ZOOM_LEVELS].reverse().find((level) => level < zoom - epsilon) ?? null);
}

export function zoomLevelForShortcut(key: string, zoom: number): number | null {
  if (key === '0') return 1;
  if (key === '+' || key === '=') return stepZoomLevel(zoom, 'in') ?? zoom;
  if (key === '-') return stepZoomLevel(zoom, 'out') ?? zoom;
  return null;
}
