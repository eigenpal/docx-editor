import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { surfaceScroller } from './surface-pages.ts';
import { setRefreshWriteGuard } from './refresh-write-guard.ts';

export interface RefreshHost {
  surface(): PaginatedSurface | null;
  container(): HTMLElement | null;
  collaboration(): boolean;
  epoch: number;
  revision: number;
  mountedRevision: number;
  cancel(): void;
  source: 'refresh' | 'recovery' | undefined;
  invalidated: Set<() => void>;
  invalidate(): void;
  mounted(bytes: Uint8Array, error?: unknown): void;
  replace(bytes: Uint8Array, source: 'refresh' | 'recovery'): Promise<boolean>;
}
const hosts = new WeakMap<DocxEditorInstance, RefreshHost>();
export function refreshHostFor(editor: DocxEditorInstance): RefreshHost {
  const host = hosts.get(editor);
  if (!host) throw new Error('External refresh requires a mounted createDocxEditor instance.');
  return host;
}
export function registerRefreshHost(
  editor: DocxEditorInstance,
  deps: {
    surface(): PaginatedSurface | null;
    container(): HTMLElement | null;
    collaboration(): boolean;
    load(bytes: Uint8Array): void;
    cancelLoad(): void;
    changed(): void;
  }
): RefreshHost {
  let recoveryViewport: { top: number; left: number } | null = null;
  let pending: {
    bytes: Uint8Array;
    resolve(ok: boolean): void;
    container: HTMLElement;
    top: number;
    left: number;
  } | null = null;
  const host: RefreshHost = {
    ...deps,
    epoch: 0,
    revision: 0,
    mountedRevision: 0,
    source: undefined,
    invalidated: new Set(),
    cancel() {
      if (!pending) return;
      deps.cancelLoad();
      const load = pending;
      pending = null;
      setRefreshWriteGuard(load.container, false);
      deps.surface()?.setEditable(editor.snapshot().editingMode !== 'viewing');
      host.source = undefined;
      load.resolve(false);
      try {
        deps.changed();
      } catch {
        /* A host observer cannot prevent cancellation. */
      }
    },
    invalidate() {
      host.cancel();
      host.epoch++;
      recoveryViewport = null;
      if (pending) {
        setRefreshWriteGuard(pending.container, false);
        pending.resolve(false);
        pending = null;
      }
      host.source = undefined;
      for (const listener of host.invalidated) listener();
    },
    mounted(bytes, error) {
      if (!pending || pending.bytes !== bytes) return;
      const load = pending;
      const ok = !error && !!deps.surface();
      host.mountedRevision = host.revision;
      if (!ok) recoveryViewport = { top: load.top, left: load.left };
      else recoveryViewport = null;
      const scroller = surfaceScroller(load.container);
      if (ok && scroller) {
        scroller.scrollTop = Math.max(
          0,
          Math.min(load.top, scroller.scrollHeight - scroller.clientHeight)
        );
        scroller.scrollLeft = Math.max(
          0,
          Math.min(load.left, scroller.scrollWidth - scroller.clientWidth)
        );
        scroller.dispatchEvent(new Event('scroll'));
      }
      if (pending !== load) return;
      pending = null;
      setRefreshWriteGuard(load.container, false);
      deps.surface()?.setEditable(editor.snapshot().editingMode !== 'viewing');
      host.source = undefined;
      load.resolve(ok);
      try {
        deps.changed();
      } catch {
        /* A host observer cannot prevent completion. */
      }
    },
    replace(bytes, source) {
      const container = deps.container();
      if (!container || pending) return Promise.resolve(false);
      const scroller = surfaceScroller(container);
      return new Promise((resolve) => {
        pending = {
          bytes,
          resolve,
          container,
          top:
            source === 'recovery' && recoveryViewport
              ? recoveryViewport.top
              : (scroller?.scrollTop ?? 0),
          left:
            source === 'recovery' && recoveryViewport
              ? recoveryViewport.left
              : (scroller?.scrollLeft ?? 0),
        };
        host.source = source;
        setRefreshWriteGuard(container, true);
        deps.surface()?.setEditable(false);
        try {
          deps.load(bytes);
        } catch (error) {
          host.mounted(bytes, error);
        }
      });
    },
  };
  editor.on('change', (change) => {
    if (!change.source) host.revision++;
  });
  hosts.set(editor, host);
  return host;
}
