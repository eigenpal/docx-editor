/**
 * Alias for cross-adapter parity — the React adapter has
 * `useWheelZoom.ts` (Ctrl+wheel zoom + Ctrl+= / Ctrl+- / Ctrl+0
 * shortcuts). Vue rolls the same behaviour into `useZoom`, which
 * already exposes `handleWheel` and `installShortcuts()`. This file
 * re-exports under the React-style name so plugin code can call
 * `useWheelZoom()` either way and get the same composable.
 */
export { useZoom as useWheelZoom } from './useZoom';
export type {} from './useZoom';
