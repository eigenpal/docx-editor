import { inject, type InjectionKey, type Ref } from 'vue';

export const ScopedByAncestorContext: InjectionKey<boolean> = Symbol('ScopedByAncestorContext');

/** True when the enclosing `Root` resolved a dark chrome. */
export const ChromeDarkContext: InjectionKey<Readonly<Ref<boolean>>> = Symbol('ChromeDarkContext');

/**
 * The scope class a part you build adds to its own root element: `'docx-editor '`, with `dark`
 * under a `DocxEditorRoot` whose `colorMode` resolved dark, or `''` when an ancestor is already
 * scoped. Call it in `setup`; it reads the theme once, so read it again to follow a change.
 *
 * @public
 */
export function useScopeClassName(): '' | 'docx-editor ' | 'docx-editor dark ' {
  if (inject(ScopedByAncestorContext, false)) return '';
  return inject(ChromeDarkContext, null)?.value ? 'docx-editor dark ' : 'docx-editor ';
}
