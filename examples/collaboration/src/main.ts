import '@docx-editor.dev/core/styles/editor.css';
import './style.css';

import { createT, en } from '@docx-editor.dev/i18n';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '@docx-editor.dev/pro';
import {
  createCollaborationRoomId,
  createWebrtcCollaboration,
  type WebrtcCollaborationHandle,
} from '@docx-editor.dev/pro/collaboration/webrtc';
import { demoDocumentBytes } from './demo-document';

const t = createT(en);
const strings = {
  title: t('collaborationDemo.title'),
  subtitle: t('collaborationDemo.subtitle'),
  name: t('collaborationDemo.name'),
  room: t('collaborationDemo.room'),
  create: t('collaborationDemo.create'),
  join: t('collaborationDemo.join'),
  share: t('collaborationDemo.share'),
  copy: t('collaborationDemo.copy'),
  copied: t('collaborationDemo.copied'),
  connection: t('collaborationDemo.connection'),
  peers: t('collaborationDemo.peers'),
  disconnect: t('collaborationDemo.disconnect'),
  reconnect: t('collaborationDemo.reconnect'),
  undo: t('collaborationDemo.undo'),
  redo: t('collaborationDemo.redo'),
  save: t('collaborationDemo.save'),
  scope: t('collaborationDemo.scope'),
  warning: t('collaborationDemo.warning'),
  failed: t('collaborationDemo.failed'),
};
const appElement = document.querySelector<HTMLElement>('#app');
if (!appElement) throw new Error('missing app root');
const app: HTMLElement = appElement;
app.classList.add('docx-editor');

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function inputLabel(text: string, input: HTMLInputElement): HTMLLabelElement {
  const label = element('label', 'field');
  label.append(element('span', 'field-label', text), input);
  return label;
}

function preventCaretLoss(button: HTMLButtonElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}

function storedName(): string {
  return localStorage.getItem('docx-collaboration-name')?.trim() || 'Collaborator';
}

function roomFromInput(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).searchParams.get('room')?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * The room's encryption key, carried in the URL fragment.
 *
 * The room id is the signaling topic, so it cannot double as the key — the signaling host sees
 * it. A fragment is never sent to that host, so two peers who opened the same invite share a
 * secret it never learns. Anyone holding the whole link can still decrypt, which is what
 * joining the room means anyway.
 */
function createRoomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

const COLLAB_FRAGMENT = '#collab=';

/** Read the key out of a pasted invite, or out of the address bar for a link opened directly. */
function roomSecretFrom(value: string): string | undefined {
  for (const candidate of [value.trim(), location.href]) {
    if (!candidate) continue;
    let hash = '';
    try {
      hash = new URL(candidate).hash;
    } catch {
      continue;
    }
    if (hash.startsWith(COLLAB_FRAGMENT)) return hash.slice(COLLAB_FRAGMENT.length);
  }
  return undefined;
}

function navigateToRoom(roomId: string, name: string, secret: string | undefined): void {
  localStorage.setItem('docx-collaboration-name', name);
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  // The key rides in the fragment so `startRoom` and the share link both see it while the
  // signaling host never does.
  url.hash = secret ? `${COLLAB_FRAGMENT.slice(1)}${secret}` : '';
  location.assign(url);
}

function renderLobby(): void {
  const shell = element('main', 'lobby');
  shell.append(element('h1', undefined, strings.title), element('p', 'subtitle', strings.subtitle));

  const name = element('input');
  name.value = storedName();
  name.autocomplete = 'name';
  const room = element('input');
  room.placeholder = strings.room;

  const create = element('button', 'primary', strings.create);
  create.type = 'button';
  create.addEventListener('click', () => {
    navigateToRoom(
      createCollaborationRoomId(),
      name.value.trim() || storedName(),
      createRoomSecret()
    );
  });
  const join = element('button', undefined, strings.join);
  join.type = 'button';
  join.addEventListener('click', () => {
    const roomId = roomFromInput(room.value);
    if (roomId) {
      navigateToRoom(roomId, name.value.trim() || storedName(), roomSecretFrom(room.value));
    }
  });

  const actions = element('div', 'lobby-actions');
  actions.append(create, join);
  shell.append(inputLabel(strings.name, name), inputLabel(strings.room, room), actions);
  shell.append(element('p', 'scope-note', strings.scope));
  shell.append(element('p', 'warning', strings.warning));
  app.replaceChildren(shell);
}

function download(bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  );
  const link = element('a');
  link.href = url;
  link.download = 'collaboration-proof.docx';
  link.click();
  URL.revokeObjectURL(url);
}

function renderRoom(
  roomId: string,
  room: WebrtcCollaborationHandle,
  editor: DocxEditorInstance
): () => void {
  const shell = element('main', 'room-shell');
  const header = element('header', 'room-header');
  const title = element('div');
  title.append(element('h1', undefined, strings.title), element('p', 'scope-note', strings.scope));

  const status = element('span', 'status');
  const peers = element('span', 'status');
  const share = new URL(location.href);
  share.search = '';
  share.searchParams.set('room', roomId);
  // The invite carries the key in its fragment, so the joiner gets both halves in one link.
  const secret = roomSecretFrom('');
  share.hash = secret ? `${COLLAB_FRAGMENT.slice(1)}${secret}` : '';
  const shareInput = element('input', 'share-link');
  shareInput.readOnly = true;
  shareInput.value = share.toString();
  shareInput.setAttribute('aria-label', strings.share);
  const copy = element('button', undefined, strings.copy);
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(shareInput.value);
    copy.textContent = strings.copied;
  });

  const undo = element('button', undefined, strings.undo);
  undo.type = 'button';
  preventCaretLoss(undo);
  undo.addEventListener('click', () => editor.exec({ type: 'undo' }));
  const redo = element('button', undefined, strings.redo);
  redo.type = 'button';
  preventCaretLoss(redo);
  redo.addEventListener('click', () => editor.exec({ type: 'redo' }));
  const disconnect = element('button', undefined, strings.disconnect);
  disconnect.type = 'button';
  disconnect.addEventListener('click', () => room.provider.disconnect());
  const reconnect = element('button', undefined, strings.reconnect);
  reconnect.type = 'button';
  reconnect.addEventListener('click', () => room.provider.connect());
  const save = element('button', 'primary', strings.save);
  save.type = 'button';
  save.addEventListener('click', async () => {
    download(new Uint8Array(await editor.save()));
  });

  const controls = element('div', 'controls');
  controls.append(status, peers, undo, redo, disconnect, reconnect, save);
  header.append(title, controls);

  const shareRow = element('div', 'share-row');
  shareRow.append(element('span', undefined, strings.share), shareInput, copy);
  const warning = element('p', 'warning', strings.warning);
  const editorHost = element('section', 'editor-host');
  editorHost.setAttribute('aria-label', strings.title);
  shell.append(header, shareRow, warning, editorHost);
  app.replaceChildren(shell);
  editor.attach(editorHost);

  const renderStatus = (): void => {
    status.textContent = `${strings.connection}: ${room.session.status()}`;
    peers.textContent = `${strings.peers}: ${room.provider.awareness.getStates().size}`;
  };
  renderStatus();
  const offStatus = room.session.subscribeStatus(renderStatus);
  room.provider.awareness.on('change', renderStatus);
  return () => {
    offStatus();
    room.provider.awareness.off('change', renderStatus);
    editor.destroy();
    room.destroy();
  };
}

async function startRoom(roomId: string): Promise<void> {
  app.replaceChildren(element('main', 'lobby', strings.connection));
  const name = storedName();
  // `create-or-join` needs no out-of-band role: the first peer seeds the room and every
  // later peer joins it, so the share link carries the room id plus the fragment key.
  // Passed explicitly rather than left for the engine to read off the address bar, so this
  // file is the one place that decides where the key comes from.
  const secret = roomSecretFrom('');
  const room = await createWebrtcCollaboration({
    roomId,
    identity: {
      actorId: `${name}:${crypto.randomUUID()}`,
      name,
      color: 'var(--doc-accent)',
    },
    bootstrap: { kind: 'create-or-join', document: demoDocumentBytes() },
    ...(secret ? { password: secret } : {}),
  });
  try {
    const editor = createDocxEditor({
      document: room.document,
      modules: [collaborationModule({ session: room.session })],
    });
    const cleanup = renderRoom(roomId, room, editor);
    addEventListener('beforeunload', cleanup, { once: true });
  } catch (error) {
    room.destroy();
    throw error;
  }
}

const parameters = new URL(location.href).searchParams;
const roomId = parameters.get('room');
if (!roomId) {
  renderLobby();
} else {
  startRoom(roomId).catch((error) => {
    const message = element('main', 'lobby');
    message.append(
      element('h1', undefined, strings.failed),
      element('p', 'warning', error instanceof Error ? error.message : strings.failed)
    );
    app.replaceChildren(message);
  });
}
