import { useId } from 'react';

/** Stable id prefix for chrome controls. */
export function useStableDocxId(suffix: string): string {
  return `${useId()}-${suffix}`;
}
