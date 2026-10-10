import { inject, type InjectionKey } from 'vue';

export const ScopedByAncestorContext: InjectionKey<boolean> = Symbol('ScopedByAncestorContext');

/** @public */
export function useScopeClassName(): '' | 'docx-editor ' {
  return inject(ScopedByAncestorContext, false) ? '' : 'docx-editor ';
}
