/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocxEditor, isDocxEditorError } from '@docx-editor.dev/editor-api';
import type { DocxEditorRuntime, DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { createYjsCollaboration, type YjsCollaborationRoom } from '../session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

const ROOM = 'headless-browser-integration';

function sync(source: Y.Doc, target: Y.Doc, origin = 'test-provider'): Uint8Array {
  const update = Y.encodeStateAsUpdate(source, Y.encodeStateVector(target));
  Y.applyUpdate(target, update, origin);
  return update;
}

function bodyText(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

async function insertAtStart(runtime: DocxEditorRuntime, text: string): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    paragraphs.items[0]!.insertText(text, 'Start');
    await context.sync();
  });
}

function observeOperations(
  session: EditorCollaborationSession,
  operationIds: string[]
): EditorCollaborationSession {
  return new Proxy(session, {
    get(target, property, receiver) {
      if (property === 'attach') {
        return (port: Parameters<EditorCollaborationSession['attach']>[0]) => {
          const unsubscribe = port.subscribe((change) => {
            if (change.operationId) operationIds.push(change.operationId);
          });
          const detach = target.attach(port);
          return () => {
            unsubscribe();
            detach();
          };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

interface Replicas {
  readonly browserDoc: Y.Doc;
  readonly browserAwareness: Awareness;
  readonly browserRoom: YjsCollaborationRoom;
  readonly browserEditor: ReturnType<typeof createDocxEditor>;
  readonly browserContainer: HTMLElement;
  readonly agentDoc: Y.Doc;
  readonly agentAwareness: Awareness;
  readonly agentOperations: string[];
  agentRoom: YjsCollaborationRoom;
  agentRuntime: DocxEditorServerRuntime;
  destroy(): void;
}

async function replicas(): Promise<Replicas> {
  const browserDoc = new Y.Doc();
  const browserAwareness = new Awareness(browserDoc);
  const browserRoom = await createYjsCollaboration({
    ydoc: browserDoc,
    awareness: browserAwareness,
    documentId: ROOM,
    sessionId: 'browser-session',
    identity: { actorId: 'browser-user', name: 'Browser user' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });

  const agentDoc = new Y.Doc();
  Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(browserDoc), 'initial-state');
  const agentAwareness = new Awareness(agentDoc);
  const agentRoom = await createYjsCollaboration({
    ydoc: agentDoc,
    awareness: agentAwareness,
    documentId: ROOM,
    sessionId: 'agent-session-1',
    identity: { actorId: 'stable-agent', name: 'Stable agent', role: 'agent' },
    bootstrap: { kind: 'join' },
  });

  const browserContainer = document.createElement('div');
  document.body.append(browserContainer);
  const browserEditor = createDocxEditor({
    container: browserContainer,
    document: browserRoom.document,
    modules: [collaborationModule({ session: browserRoom.session })],
  });
  const agentOperations: string[] = [];
  const agentRuntime = await DocxEditor.createCollaborative(
    agentRoom.document,
    observeOperations(agentRoom.session, agentOperations)
  );

  return {
    browserDoc,
    browserAwareness,
    browserRoom,
    browserEditor,
    browserContainer,
    agentDoc,
    agentAwareness,
    agentOperations,
    agentRoom,
    agentRuntime,
    destroy() {
      agentRuntime.dispose();
      browserEditor.destroy();
      agentRoom.destroy();
      browserRoom.destroy();
      agentAwareness.destroy();
      browserAwareness.destroy();
      agentDoc.destroy();
      browserDoc.destroy();
      browserContainer.remove();
    },
  };
}

describe('DocxEditor.createCollaborative integration', () => {
  test('independent browser and headless replicas synchronize in both directions', async () => {
    const state = await replicas();
    try {
      expect(state.browserEditor.exec({ type: 'insertText', text: '[browser]' })).toMatchObject({
        ok: true,
        changed: true,
      });
      sync(state.browserDoc, state.agentDoc);
      expect(await bodyText(state.agentRuntime)).toContain('[browser]');

      await insertAtStart(state.agentRuntime, '[agent]');
      sync(state.agentDoc, state.browserDoc);
      const browserSaved = new Uint8Array(await state.browserEditor.save());
      const agentSaved = await state.agentRuntime.save();
      const browserPackage = readOoxmlPackage(browserSaved);
      const agentPackage = readOoxmlPackage(agentSaved);
      if (!browserPackage.ok || !agentPackage.ok) throw new Error('converged save did not reopen');
      const browserMain = browserPackage.package.parts.get(
        browserPackage.package.mainDocumentPart
      )!;
      const agentMain = agentPackage.package.parts.get(agentPackage.package.mainDocumentPart)!;
      expect(canonicalOoxmlFingerprint(browserMain)).toBe(canonicalOoxmlFingerprint(agentMain));
      expect(semanticDigest([browserMain])).toEqual(semanticDigest([agentMain]));

      const reopened = await DocxEditor.createServer(browserSaved);
      expect(await bodyText(reopened)).toContain('[agent]');
      reopened.dispose();

      const beforeDuplicate = new Uint8Array(await state.browserEditor.save());
      const duplicate = Y.encodeStateAsUpdate(state.agentDoc);
      Y.applyUpdate(state.browserDoc, duplicate, 'duplicate-operation');
      Y.applyUpdate(state.browserDoc, duplicate, 'duplicate-operation');
      expect(new Uint8Array(await state.browserEditor.save())).toEqual(beforeDuplicate);
    } finally {
      state.destroy();
    }
  });

  test('agent refusals are atomic and reads see only committed state', async () => {
    const state = await replicas();
    try {
      const before = await bodyText(state.agentRuntime);
      const unsupported = state.agentRuntime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[0]!.insertParagraph('unsupported', 'After');
        await context.sync();
      });
      const unsupportedError = await unsupported.catch((error: unknown) => error);
      expect(isDocxEditorError(unsupportedError)).toBe(true);
      expect(await bodyText(state.agentRuntime)).toBe(before);

      const oversized = state.agentRuntime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[0]!.insertText('x'.repeat(1_000_001), 'Start');
        await context.sync();
      });
      const oversizedError = await oversized.catch((error: unknown) => error);
      expect(isDocxEditorError(oversizedError)).toBe(true);
      expect(await bodyText(state.agentRuntime)).toBe(before);

      await state.agentRuntime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        paragraphs.items[0]!.insertText('[pending]', 'Start');
        expect(await bodyText(state.agentRuntime)).toBe(before);
        await context.sync();
      });
      expect(await bodyText(state.agentRuntime)).toContain('[pending]');
    } finally {
      state.destroy();
    }
  });

  test('reconnect uses a new session identity and teardown preserves borrowed resources', async () => {
    const state = await replicas();
    try {
      await insertAtStart(state.agentRuntime, '[first-session]');
      const acknowledged = sync(state.agentDoc, state.browserDoc);
      const firstSessionId = state.agentRoom.session.sessionId;
      expect(state.agentOperations).toContain('stable-agent:agent-session-1:automation:1');

      state.agentRuntime.dispose();
      state.agentRoom.destroy();
      expect(state.agentDoc.isDestroyed).toBe(false);

      state.agentRoom = await createYjsCollaboration({
        ydoc: state.agentDoc,
        awareness: state.agentAwareness,
        documentId: ROOM,
        sessionId: 'agent-session-2',
        identity: { actorId: 'stable-agent', name: 'Stable agent', role: 'agent' },
        bootstrap: { kind: 'join' },
      });
      state.agentRuntime = await DocxEditor.createCollaborative(
        state.agentRoom.document,
        observeOperations(state.agentRoom.session, state.agentOperations)
      );
      expect(state.agentRoom.session.identity.actorId).toBe('stable-agent');
      expect(state.agentRoom.session.sessionId).not.toBe(firstSessionId);

      await insertAtStart(state.agentRuntime, '[second-session]');
      expect(state.agentOperations).toContain('stable-agent:agent-session-2:automation:1');
      expect(new Set(state.agentOperations).size).toBe(state.agentOperations.length);
      sync(state.agentDoc, state.browserDoc, 'reconnected-provider');
      const beforeDuplicate = new Uint8Array(await state.browserEditor.save());
      Y.applyUpdate(state.browserDoc, acknowledged, 'acknowledged-duplicate');
      expect(new Uint8Array(await state.browserEditor.save())).toEqual(beforeDuplicate);
    } finally {
      state.destroy();
    }
  });
});
