import type { CanResult, ExecResult } from '../contracts/editor.ts';
import type { RevisionMarkupDialog, ReviewModuleContribution } from '../contracts/modules.ts';
import {
  resolveRevisionMarkup,
  type RevisionMarkupOptions,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';

/** Owns viewer preferences and disposable review chrome outside the document store. */
export function createRevisionMarkupState(
  initial: RevisionMarkupOptions | undefined,
  host: {
    container(): HTMLElement | null;
    destroyed(): boolean;
    contribution(): ReviewModuleContribution | null;
    translate(): ((key: string) => string) | undefined;
    apply(value: ResolvedRevisionMarkup): void;
    changed(value: ResolvedRevisionMarkup): void;
  }
) {
  let value = resolveRevisionMarkup(initial);
  let dialog: RevisionMarkupDialog | null = null;
  const listeners = new Set<() => void>();
  const canOpen = (): CanResult => {
    if (host.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!host.contribution()?.createRevisionMarkupDialog)
      return {
        ok: false,
        code: 'unsupported',
        reason: 'the review module does not supply a settings dialog',
      };
    if (!host.container())
      return { ok: false, code: 'notFound', reason: 'the editor is not attached' };
    return { ok: true };
  };
  const set = (options: RevisionMarkupOptions): void => {
    if (host.destroyed()) return;
    const next = resolveRevisionMarkup(options, value);
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    value = next;
    host.apply(value);
    for (const listener of [...listeners]) listener();
    host.changed(value);
  };
  return {
    current: () => value,
    set,
    canOpen,
    open(): ExecResult {
      const result = canOpen();
      if (!result.ok) return result;
      dialog ??= host.contribution()!.createRevisionMarkupDialog!({
        container: host.container()!,
        get: () => value,
        set,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        translate: (key) => host.translate()?.(key),
      });
      dialog.open();
      return { ok: true, changed: false };
    },
    destroyDialog() {
      dialog?.destroy();
      dialog = null;
    },
  };
}
