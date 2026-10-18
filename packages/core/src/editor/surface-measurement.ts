import type { PaginatedSurface, PaginatedSurfaceOptions } from './paginated-surface.ts';

type Measurement = Pick<
  PaginatedSurfaceOptions,
  'measurer' | 'producer' | 'fontAlias' | 'defaultFontFamily'
>;
const updates = new WeakMap<
  PaginatedSurface,
  (next: Measurement, restoreOnFailure: boolean) => void
>();

/** Internal seam: refresh geometry without replacing the editing session or its history. */
export function registerSurfaceMeasurement(
  surface: PaginatedSurface,
  read: () => Measurement,
  write: (next: Measurement) => void,
  refresh: () => void
): void {
  updates.set(surface, (next, restoreOnFailure) => {
    const previous = read();
    surface.flushPendingInput();
    try {
      write(next);
      refresh();
    } catch (error) {
      if (restoreOnFailure) {
        write(previous);
        refresh();
      }
      throw error;
    }
  });
}

export function updateSurfaceMeasurement(
  surface: PaginatedSurface,
  next: Measurement,
  restoreOnFailure = true
): void {
  const update = updates.get(surface);
  if (!update) throw new Error('Surface does not support measurement updates');
  update(next, restoreOnFailure);
}
