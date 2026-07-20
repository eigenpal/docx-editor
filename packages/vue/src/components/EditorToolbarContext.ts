/**
 * Vue mirror of packages/react/src/components/EditorToolbarContext.tsx —
 * exposes a provide/inject pair so toolbar sub-components can
 * pull shared props from a parent EditorToolbar without prop
 * drilling. React uses createContext + useContext; Vue uses
 * provide / inject with a typed InjectionKey.
 */
import { provide, inject, type InjectionKey } from 'vue';

/**
 * Shared toolbar prop bag — mirrors React's ToolbarProps. Loosely
 * typed because the consumer surface here is just the slot-down
 * channel; tightening would require dragging the entire
 * ToolbarProps interface across the framework boundary.
 */
export type EditorToolbarProps = Record<string, unknown>;

const KEY: InjectionKey<EditorToolbarProps> = Symbol('docx-editor-toolbar');

export function provideEditorToolbar(props: EditorToolbarProps): void {
  provide(KEY, props);
}

export function useEditorToolbar(): EditorToolbarProps {
  const ctx = inject(KEY, null as unknown as EditorToolbarProps | null);
  if (!ctx) {
    throw new Error('useEditorToolbar must be used within an <EditorToolbar> component');
  }
  return ctx;
}
