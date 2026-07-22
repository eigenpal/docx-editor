/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import type { DocxEditor, EditorDriver } from '../driver/editor-driver';
import { nonEmptyString } from '../driver/editor-driver';
import { loadPocDocx } from './docx';
import { createPocEditorSession, type PocEditorSession } from './session';

export interface CreateHeadlessPocEditorDriverOptions {
  readonly editableClientId?: number;
  readonly replicaClientId?: number;
}

export function createHeadlessPocEditorDriver(
  options: CreateHeadlessPocEditorDriverOptions = {}
): EditorDriver {
  let session: PocEditorSession | null = null;

  const requireSession = (): PocEditorSession => {
    if (!session) throw new Error('driver.loadDocx must be called before other methods');
    return session;
  };

  const driver: EditorDriver = {
    async loadDocx(bytes: Uint8Array) {
      const loaded = await loadPocDocx(bytes);
      session = createPocEditorSession(loaded, {
        editable: {
          actorId: 'driver-editable',
          sessionId: 'driver-editable-session',
          clientId: options.editableClientId ?? 801,
        },
        replica: {
          actorId: 'driver-replica',
          sessionId: 'driver-replica-session',
          clientId: options.replicaClientId ?? 802,
        },
      });
    },
    async selectText(text: string) {
      if (!requireSession().selectText(text)) {
        throw new Error(`text not found: ${text}`);
      }
    },
    async type(text: string) {
      requireSession().typeText(text);
    },
    async execute(command: DocxEditor.Command) {
      if (command.type === 'toggleMark') {
        return requireSession().toggleMark(command.mark);
      }
      return Object.freeze({
        status: 'failed',
        code: 'unsupported-command',
        reason: 'command type is not supported by the POC driver',
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
      return requireSession().undo();
    },
    async save() {
      return Object.freeze({
        status: 'failed',
        code: 'not-implemented',
        reason: 'DOCX save/reopen is milestone 4',
      });
    },
  };

  return Object.freeze(driver);
}

export function assertDriverQueryText(text: string): DocxEditor.NonEmptyString {
  return nonEmptyString(text);
}
