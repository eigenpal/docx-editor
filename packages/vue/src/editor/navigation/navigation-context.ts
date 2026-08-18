import { inject, type InjectionKey } from 'vue';
import type { UseNavigationPaneResult } from './useNavigationPane';
import type { UseDocumentOutlineResult } from './useDocumentOutline';
import type { UseDocumentSearchResult } from './useDocumentSearch';

export interface NavigationContextValue {
  readonly pane: UseNavigationPaneResult;
  readonly outline: UseDocumentOutlineResult;
  readonly search: UseDocumentSearchResult;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export const NavigationContext: InjectionKey<NavigationContextValue | null> =
  Symbol('NavigationContext');

export function useNavigationContext(part: string): NavigationContextValue {
  const value = inject(NavigationContext, null);
  if (!value) {
    throw new Error(
      `<DocxEditor.Navigation.${part}> must be rendered inside <DocxEditor.Navigation>`
    );
  }
  return value;
}
