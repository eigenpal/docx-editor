import type { PaginatedSurface } from './paginated-surface-contract.ts';

const guarded = new WeakSet<HTMLElement>();
const compositions = new WeakMap<PaginatedSurface, () => boolean>();
export const refreshWriteBlocked = (container: HTMLElement): boolean => guarded.has(container);
export function setRefreshWriteGuard(container: HTMLElement, blocked: boolean): void {
  if (blocked) guarded.add(container);
  else guarded.delete(container);
}
export function registerRefreshComposition(surface: PaginatedSurface, read: () => boolean): void {
  compositions.set(surface, read);
}
export const refreshCompositionActive = (surface: PaginatedSurface): boolean =>
  compositions.get(surface)?.() ?? false;
