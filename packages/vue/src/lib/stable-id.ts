import { getCurrentInstance } from 'vue';

const appCounters = new WeakMap<object, number>();

/** Stable, hydration-safe id prefix for chrome controls. */
export function useStableDocxId(suffix: string): string {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('useStableDocxId must run during component setup');
  }
  const appContext = instance.appContext;
  const sequence = appCounters.get(appContext) ?? 0;
  appCounters.set(appContext, sequence + 1);
  return `docx-${sequence}-${suffix}`;
}
