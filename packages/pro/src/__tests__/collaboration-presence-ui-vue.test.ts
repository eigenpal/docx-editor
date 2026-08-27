/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue collaboration presence compound — exact twin of the React suite: caret labels
// teleport host content into the engine's anchors WITH adapter context working inside, and
// the avatar stack resolves its colours through the same review roster the paint uses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { defineComponent, h, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type {
  CollaborationParticipant,
  CollaborationRemoteSelection,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { DocxEditorCollaboration } from '../vue/index.ts';
import type { CollaborationSession } from '../collaboration/session.ts';
import { collaborationModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const INS =
  '<w:p><w:ins w:id="1" w:author="Reviewer One" w:date="2024-01-01T00:00:00Z">' +
  '<w:r><w:t>tracked</w:t></w:r></w:ins></w:p>';
const PLAIN = '<w:p><w:r><w:t>plain paragraph</w:t></w:r></w:p>';

function stubSession(): EditorCollaborationSession &
  CollaborationSession & {
    setRemotes(next: readonly CollaborationRemoteSelection[]): void;
    setParticipants(next: readonly CollaborationParticipant[]): void;
    notify(): void;
  } {
  let remotes: readonly CollaborationRemoteSelection[] = [];
  let roster: readonly CollaborationParticipant[] = [];
  const selectionListeners = new Set<
    (selections: readonly CollaborationRemoteSelection[]) => void
  >();
  const participantListeners = new Set<
    (participants: readonly CollaborationParticipant[]) => void
  >();
  return {
    documentId: 'presence-ui-room',
    sessionId: 'presence-ui-session',
    identity: { actorId: 'local', name: 'Local' },
    status: () => 'ready',
    statusSnapshot: () =>
      Object.freeze({ status: 'ready' as const, reason: undefined, lastFailure: undefined }),
    subscribeStatus: () => () => {},
    attached: true,
    attach: () => () => {},
    gateOperations: () => null,
    canUndo: () => false,
    canRedo: () => false,
    undo: () => false,
    redo: () => false,
    setLocalSelection: () => {},
    participants: () => Object.freeze([...roster]),
    subscribeParticipants: (listener) => {
      participantListeners.add(listener);
      return () => participantListeners.delete(listener);
    },
    remoteSelections: () => remotes,
    subscribeRemoteSelections: (listener) => {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    flushPendingJournals: () => {},
    destroy: () => {},
    setRemotes(next) {
      remotes = next;
    },
    setParticipants(next) {
      roster = next;
    },
    notify() {
      for (const listener of [...selectionListeners]) listener(remotes);
      for (const listener of [...participantListeners]) listener(Object.freeze([...roster]));
    },
  };
}

function caretOf(
  actorId: string,
  name: string,
  nodeId: string,
  color?: string
): CollaborationRemoteSelection {
  return {
    actorId,
    name,
    ...(color ? { color } : {}),
    anchor: { paragraphId: 'AAAAAAAA', nodeId, offset: 0 },
    head: { paragraphId: 'AAAAAAAA', nodeId, offset: 0 },
  };
}

function participantOf(
  actorId: string,
  name: string,
  options: { color?: string; isLocal?: boolean } = {}
): CollaborationParticipant {
  return {
    actorId,
    name,
    ...(options.color ? { color: options.color } : {}),
    role: 'human',
    isLocal: options.isLocal ?? false,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorCollaboration.CaretLabels (Vue)', () => {
  test('renders the scoped slot into the engine label with adapter context working', async () => {
    const session = stubSession();
    // The design-partner requirement: the label's renderer reads the OPENED DOCUMENT
    // through the ordinary adapter composables, not only the collaborator handed to it.
    const LabelProbe = defineComponent({
      props: { name: { type: String, required: true } },
      setup(props) {
        const editorRef = useDocxEditor();
        const pageTotal = useEditorState((state) => state.page.total);
        return () =>
          h(
            'span',
            { 'data-testid': 'label-probe' },
            `${props.name}|pages:${pageTotal.value}|editor:${editorRef.value ? 'yes' : 'no'}`
          );
      },
    });
    const mounted = mountEditorTree(
      () =>
        h(
          DocxEditorCollaboration.CaretLabels,
          { session },
          {
            default: ({ selection }: { selection: CollaborationRemoteSelection }) =>
              h(LabelProbe, { name: selection.name }),
          }
        ),
      docx(PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const ids = mounted.editor().surface!.session.paragraphIds();
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
      await nextTick();
      await flush();
      const label = mounted.container.querySelector<HTMLElement>('.docx-remote-caret-label');
      expect(label).toBeTruthy();
      expect(label!.getAttribute('data-docx-remote-actor')).toBe('bob');
      const probe = label!.querySelector<HTMLElement>('[data-testid="label-probe"]');
      expect(probe).toBeTruthy();
      expect(probe!.textContent).toBe('Bob|pages:1|editor:yes');
    } finally {
      mounted.unmount();
    }
  });

  test('mounted bare it renders the collaborator name, matching the engine default', async () => {
    const session = stubSession();
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.CaretLabels, { session }),
      docx(PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const ids = mounted.editor().surface!.session.paragraphIds();
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
      await nextTick();
      await flush();
      const label = mounted.container.querySelector<HTMLElement>('.docx-remote-caret-label');
      expect(label!.textContent).toBe('Bob');
    } finally {
      mounted.unmount();
    }
  });

  test('unmounting restores the engine default name labels', async () => {
    const session = stubSession();
    const mounted = mountEditorTree(
      () => [],
      docx(PLAIN),
      () =>
        h(
          DocxEditorCollaboration.CaretLabels,
          { session },
          {
            default: ({ selection }: { selection: CollaborationRemoteSelection }) =>
              h('em', selection.name.toUpperCase()),
          }
        ),
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const ids = mounted.editor().surface!.session.paragraphIds();
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
      await nextTick();
      await flush();
      expect(mounted.container.querySelector('.docx-remote-caret-label')!.textContent).toBe('BOB');
      mounted.viewportVisible.value = false;
      await nextTick();
      await flush();
      const restored = mounted.container.querySelector<HTMLElement>('.docx-remote-caret-label');
      expect(restored).toBeTruthy();
      expect(restored!.textContent).toBe('Bob');
      expect(restored!.hasAttribute('data-docx-remote-actor')).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  test('the slot colour is the painted label colour for a roster author', async () => {
    const session = stubSession();
    const seenColors: string[] = [];
    const mounted = mountEditorTree(
      () =>
        h(
          DocxEditorCollaboration.CaretLabels,
          { session },
          {
            default: ({
              selection,
              color,
            }: {
              selection: CollaborationRemoteSelection;
              color: string;
            }) => {
              seenColors.push(color);
              return h('span', selection.name);
            },
          }
        ),
      docx(INS + PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const ids = mounted.editor().surface!.session.paragraphIds();
      session.setRemotes([caretOf('a1', 'Reviewer One', ids.at(-1)!)]);
      session.notify();
      await nextTick();
      await flush();
      const label = mounted.container.querySelector<HTMLElement>('.docx-remote-caret-label');
      const painted = label!.style.getPropertyValue('--doc-remote-color');
      expect(painted).toBe('var(--doc-review-author-0)');
      expect(seenColors.at(-1)).toBe(painted);
      const rosterInfo = mounted
        .editor()
        .getReviewAuthors()
        .find((info) => info.author === 'Reviewer One');
      expect(rosterInfo?.color).toBe(painted);
    } finally {
      mounted.unmount();
    }
  });
});

describe('DocxEditorCollaboration.Avatars (Vue)', () => {
  test('sorts local first then by name, shows initials, and marks the parts', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('c', 'Zoe Quinn'),
      participantOf('b', 'Ada Lovelace', { color: '#aabbcc' }),
      participantOf('a', 'Mina Murray', { isLocal: true }),
    ]);
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.Avatars, { session }),
      docx(PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const stack = mounted.container.querySelector<HTMLElement>('[data-collaboration-avatars]');
      expect(stack).toBeTruthy();
      expect(stack!.getAttribute('aria-label')).toBe('People in this document');
      const avatars = [...stack!.querySelectorAll<HTMLElement>('[data-collaboration-avatar]')];
      expect(avatars.map((avatar) => avatar.title)).toEqual([
        'Mina Murray',
        'Ada Lovelace',
        'Zoe Quinn',
      ]);
      expect(avatars.map((avatar) => avatar.textContent)).toEqual(['MM', 'AL', 'ZQ']);
      expect(avatars[0]!.hasAttribute('data-local')).toBe(true);
      expect(avatars[1]!.hasAttribute('data-local')).toBe(false);
      expect(avatars[1]!.style.getPropertyValue('--doc-collaboration-accent')).toBe('#aabbcc');
      expect(avatars[1]!.hasAttribute('data-collaboration-author-slot')).toBe(false);
      expect(avatars[0]!.hasAttribute('data-collaboration-author-slot')).toBe(true);
      expect(avatars[0]!.getAttribute('aria-label')).toBe('Mina Murray');
    } finally {
      mounted.unmount();
    }
  });

  test('max collapses the overflow into a "+N" chip', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('a', 'Ada', { isLocal: true }),
      participantOf('b', 'Bob'),
      participantOf('c', 'Cleo'),
      participantOf('d', 'Dora'),
    ]);
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.Avatars, { session, max: 2 }),
      docx(PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const avatars = [
        ...mounted.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
      ];
      expect(avatars).toHaveLength(3);
      const chip = avatars.at(-1)!;
      expect(chip.hasAttribute('data-overflow')).toBe(true);
      expect(chip.textContent).toBe('+2');
      expect(chip.getAttribute('title')).toBe('2 more people');
    } finally {
      mounted.unmount();
    }
  });

  test('a colourless roster author takes the review accent; the slot matches', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('local', 'Someone Else', { isLocal: true, color: '#112233' }),
      participantOf('a1', 'Reviewer One'),
    ]);
    const seen: { name: string; color: string; initials: string }[] = [];
    const mounted = mountEditorTree(
      () => [
        h(DocxEditorCollaboration.Avatars, { session }),
        h(
          DocxEditorCollaboration.Avatars,
          { session },
          {
            default: ({
              participant,
              color,
              initials,
            }: {
              participant: CollaborationParticipant;
              color: string;
              initials: string;
            }) => {
              seen.push({ name: participant.name, color, initials });
              return h('b', { 'data-testid': 'custom-avatar' }, initials);
            },
          }
        ),
      ],
      docx(INS + PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const rosterInfo = mounted
        .editor()
        .getReviewAuthors()
        .find((info) => info.author === 'Reviewer One');
      expect(rosterInfo).toBeTruthy();
      const reviewer = [
        ...mounted.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
      ].find((avatar) => avatar.title === 'Reviewer One');
      expect(reviewer!.style.getPropertyValue('--doc-collaboration-accent')).toBe(
        rosterInfo!.color
      );
      expect(reviewer!.getAttribute('data-collaboration-author-slot')).toBe(
        String(rosterInfo!.slot % 8)
      );
      const custom = seen.find((entry) => entry.name === 'Reviewer One');
      expect(custom?.color).toBe(rosterInfo!.color);
      expect(custom?.initials).toBe('RO');
      expect(mounted.container.querySelectorAll('[data-testid="custom-avatar"]')).toHaveLength(2);
    } finally {
      mounted.unmount();
    }
  });

  test('renders nothing without participants', async () => {
    const session = stubSession();
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.Avatars, { session }),
      docx(PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      expect(mounted.container.querySelector('[data-collaboration-avatars]')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  // A declared review colour is host input in any CSS shape. The paint sink refuses what
  // it cannot paint, so the shared resolution falls to the author's slot token — the
  // painted caret and the avatar must agree either way.
  test('a declared non-hex colour falls to the slot var on caret and avatar alike', async () => {
    const session = stubSession();
    session.setParticipants([participantOf('a1', 'Reviewer One')]);
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.Avatars, { session }),
      docx(INS + PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const paintedAndAvatar = () => {
        const label = mounted.container.querySelector<HTMLElement>('.docx-remote-caret-label')!;
        const avatar = [
          ...mounted.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
        ].find((candidate) => candidate.title === 'Reviewer One')!;
        return {
          caret: label.style.getPropertyValue('--doc-remote-color'),
          avatar: avatar.style.getPropertyValue('--doc-collaboration-accent'),
        };
      };
      const ids = mounted.editor().surface!.session.paragraphIds();
      mounted.editor().setRevisionStyles({ authors: { 'Reviewer One': { color: 'crimson' } } });
      session.setRemotes([caretOf('a1', 'Reviewer One', ids.at(-1)!)]);
      session.notify();
      await nextTick();
      await flush();
      const refused = paintedAndAvatar();
      expect(refused.caret).toBe('var(--doc-review-author-0)');
      expect(refused.avatar).toBe('var(--doc-review-author-0)');
      mounted.editor().setRevisionStyles({ authors: { 'Reviewer One': { color: '#cc0000' } } });
      session.notify();
      await nextTick();
      await flush();
      const declared = paintedAndAvatar();
      expect(declared.caret).toBe('#cc0000');
      expect(declared.avatar).toBe('#cc0000');
    } finally {
      mounted.unmount();
    }
  });

  // Colourless names outside the roster: the ENGINE's stable allocator is the one
  // authority. Session order (Uma before Vic) differs from remote paint order (Vic
  // first); pre-unification the avatars recomputed by session order while the carets
  // allocated by first resolution, and the two could swap colours.
  test('unknown colourless participants take the painted caret colours', async () => {
    const session = stubSession();
    session.setParticipants([participantOf('u1', 'Uma'), participantOf('u2', 'Vic')]);
    const mounted = mountEditorTree(
      () => h(DocxEditorCollaboration.Avatars, { session }),
      docx(PLAIN + PLAIN),
      () => [],
      [collaborationModule({ session })]
    );
    try {
      await flush();
      const ids = mounted.editor().surface!.session.paragraphIds();
      // Paint order deliberately differs from session order.
      session.setRemotes([caretOf('u2', 'Vic', ids[1]!), caretOf('u1', 'Uma', ids[0]!)]);
      session.notify();
      await nextTick();
      await flush();
      const labels = [
        ...mounted.container.querySelectorAll<HTMLElement>('.docx-remote-caret-label'),
      ];
      const caretColor = (name: string) =>
        labels
          .find((label) => label.textContent === name)!
          .style.getPropertyValue('--doc-remote-color');
      const avatars = [
        ...mounted.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
      ];
      const avatarColor = (name: string) =>
        avatars
          .find((avatar) => avatar.title === name)!
          .style.getPropertyValue('--doc-collaboration-accent');
      expect(caretColor('Uma')).toMatch(/^var\(--doc-review-author-\d\)$/);
      expect(caretColor('Vic')).toMatch(/^var\(--doc-review-author-\d\)$/);
      expect(caretColor('Uma')).not.toBe(caretColor('Vic'));
      expect(avatarColor('Uma')).toBe(caretColor('Uma'));
      expect(avatarColor('Vic')).toBe(caretColor('Vic'));
    } finally {
      mounted.unmount();
    }
  });
});
