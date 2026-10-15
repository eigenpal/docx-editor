import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** Why a write is refused while an external document refresh holds the guard. */
export const REFRESH_WRITE_REFUSAL = 'An external document refresh is in progress.';
/** The result a surface commit the guard skipped stands for: refused for the refresh. */
export const refreshRefusedCommit = () =>
  ({ committed: false, rejected: true, opCount: 0, reason: REFRESH_WRITE_REFUSAL }) as const;

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
