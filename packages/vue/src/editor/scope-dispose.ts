import { getCurrentScope, onScopeDispose } from 'vue';

/** Register cleanup only when a component/effect scope is active. @internal */
export function scopeDispose(cleanup: () => void): void {
  if (getCurrentScope()) onScopeDispose(cleanup);
}
