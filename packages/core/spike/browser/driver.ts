import type { DocxEditor, EditorDriver } from '../src/driver/editor-driver';
import { loadPocDocx } from '../src/poc/docx';
import {
  allocatePocEditorSessionOptions,
  createPocEditorSession,
  type PocEditorSession,
} from '../src/poc/session';
import {
  mountPocEditorBinding,
  syncPmSelectionFromSession,
  type PocEditorBinding,
} from './pm-binding';

export interface PocEditorDriverHost extends HTMLElement {
  dataset: DOMStringMap & {
    syncStatus?: string;
    saveStatus?: string;
  };
}

export interface CreatePocEditorDriverOptions {
  readonly editableHost: HTMLElement;
  readonly replicaHost: HTMLElement;
  readonly statusHost: HTMLElement;
}

export function createPocEditorDriver(options: CreatePocEditorDriverOptions): EditorDriver {
  let session: PocEditorSession | null = null;
  let binding: PocEditorBinding | null = null;

  const setStatus = (syncStatus: string, saveStatus = 'idle'): void => {
    const host = options.statusHost.closest('[data-poc-root]') as PocEditorDriverHost | null;
    if (host) {
      host.dataset.syncStatus = syncStatus;
      host.dataset.saveStatus = saveStatus;
    }
    options.statusHost.textContent = `Connection: ${syncStatus}; Save: ${saveStatus}`;
  };

  const requireSession = (): PocEditorSession => {
    if (!session) throw new Error('driver.loadDocx must be called before other methods');
    return session;
  };

  const driver: EditorDriver = {
    async loadDocx(bytes: Uint8Array) {
      binding?.destroy();
      const loaded = await loadPocDocx(bytes);
      session = createPocEditorSession(loaded, allocatePocEditorSessionOptions('browser'));
      binding = mountPocEditorBinding({
        session,
        editableHost: options.editableHost,
        replicaHost: options.replicaHost,
        onStatusChange: (status) => setStatus(status),
      });
      setStatus('connected');
    },
    async selectText(text: string) {
      if (!requireSession().selectText(text)) {
        throw new Error(`text not found: ${text}`);
      }
      if (binding) syncPmSelectionFromSession(session!, binding.editableView);
    },
    async type(text: string) {
      requireSession().typeText(text);
      if (binding) syncPmSelectionFromSession(session!, binding.editableView);
    },
    async execute(command: DocxEditor.Command) {
      const current = requireSession();
      if (command.type !== 'toggleMark') {
        return Object.freeze({
          status: 'failed',
          code: 'unsupported-command',
          reason: 'command type is not supported by the POC driver',
        });
      }
      const result = current.toggleMark(command.mark);
      if (binding && result.status === 'applied') {
        syncPmSelectionFromSession(session!, binding.editableView);
      }
      return result;
    },
    async applyRemoteEdit(input: { readonly text: string }) {
      const current = requireSession();
      if (input.text.length === 0) {
        return Object.freeze({
          status: 'noOp',
          changed: false,
          reason: 'empty text',
        });
      }
      const before = JSON.stringify(current.editable.snapshot());
      current.applyRemoteReplicaEdit((store) => {
        store.insert(store.snapshot().text.length, input.text);
      });
      if (binding) {
        syncPmSelectionFromSession(session!, binding.editableView);
      }
      setStatus(current.snapshotsConverged() ? 'converged' : 'connected');
      const changed = JSON.stringify(current.editable.snapshot()) !== before;
      return Object.freeze({
        status: changed ? 'applied' : 'noOp',
        ...(changed ? { changed: true } : { changed: false, reason: 'no store change' }),
      });
    },
    async query<T extends DocxEditor.Query['type']>(
      query: Extract<DocxEditor.Query, { type: T }>
    ): Promise<Extract<DocxEditor.QueryResult, { type: T }>> {
      const current = requireSession();
      if (query.type === 'findText') {
        const findQuery = query as Extract<DocxEditor.Query, { type: 'findText' }>;
        return {
          type: 'findText',
          ranges: current.findText(findQuery.text),
        } as Extract<DocxEditor.QueryResult, { type: T }>;
      }
      if (query.type === 'selectedText') {
        return {
          type: 'selectedText',
          text: current.selectedText(),
        } as Extract<DocxEditor.QueryResult, { type: T }>;
      }
      if (query.type === 'selectionFormatting') {
        return {
          type: 'selectionFormatting',
          formatting: current.selectionFormatting(),
        } as Extract<DocxEditor.QueryResult, { type: T }>;
      }
      return {
        type: 'selection',
        range: current.selectionRange(),
      } as Extract<DocxEditor.QueryResult, { type: T }>;
    },
    async undo() {
      const result = requireSession().undo();
      if (binding && result.status === 'applied') {
        syncPmSelectionFromSession(session!, binding.editableView);
      }
      setStatus(session?.snapshotsConverged() ? 'converged' : 'connected');
      return result;
    },
    async save() {
      const result = await requireSession().saveDocx();
      setStatus(session?.snapshotsConverged() ? 'converged' : 'connected', result.status);
      return result;
    },
  };

  return Object.freeze(driver);
}
