/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The React collaboration presence compound: caret labels portal host content into the
// engine's anchors WITH adapter context working inside, and the avatar stack resolves its
// colours through the same review roster the painted presence uses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type {
  CollaborationParticipant,
  CollaborationRemoteSelection,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import {
  DocxEditorAuthorStyle,
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
  useDocxEditor,
  useEditorState,
} from '@docx-editor.dev/react';
import { DocxEditorCollaboration, DocxEditorCollaborationRoot } from '../react/index.ts';
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

/** A controllable session: the engine attaches it, the test drives presence and selections. */
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
  cleanup();
});

async function mountEditor(body: string, session: ReturnType<typeof stubSession>, ui: unknown) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={docx(body)}
      modules={[collaborationModule({ session })]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      {ui as React.ReactNode}
    </DocxEditorRoot>
  );
  await act(async () => {});
  return { view, editor: () => instance! };
}

describe('DocxEditorCollaboration.CaretLabels', () => {
  test('renders the host component into the engine label with adapter context working', async () => {
    const session = stubSession();
    // The design-partner requirement: the label's renderer reads the OPENED DOCUMENT
    // through the ordinary adapter hooks, not only the collaborator handed to it.
    function LabelProbe({ name }: { name: string }) {
      const editor = useDocxEditor();
      const pageTotal = useEditorState((state) => state.page.total);
      return (
        <span data-testid="label-probe">{`${name}|pages:${pageTotal}|editor:${editor ? 'yes' : 'no'}`}</span>
      );
    }
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.CaretLabels session={session}>
        {({ selection }) => <LabelProbe name={selection.name} />}
      </DocxEditorCollaboration.CaretLabels>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    expect(label).toBeTruthy();
    expect(label!.getAttribute('data-docx-remote-actor')).toBe('bob');
    const probe = label!.querySelector<HTMLElement>('[data-testid="label-probe"]');
    expect(probe).toBeTruthy();
    expect(probe!.textContent).toBe('Bob|pages:1|editor:yes');
  });

  test('mounted bare it renders the collaborator name, matching the engine default', async () => {
    const session = stubSession();
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.CaretLabels session={session} />
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    expect(label!.textContent).toBe('Bob');
  });

  test('unmounting restores the engine default name labels', async () => {
    const session = stubSession();
    let instance: DocxEditorInstance | null = null;
    function Harness({ withLabels }: { withLabels: boolean }) {
      return (
        <DocxEditorRoot
          document={docx(PLAIN)}
          modules={[collaborationModule({ session })]}
          onReady={(editor) => {
            instance = editor as DocxEditorInstance;
          }}
        >
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
          {withLabels ? (
            <DocxEditorCollaboration.CaretLabels session={session}>
              {({ selection }) => <em>{selection.name.toUpperCase()}</em>}
            </DocxEditorCollaboration.CaretLabels>
          ) : null}
        </DocxEditorRoot>
      );
    }
    const view = render(<Harness withLabels />);
    await act(async () => {});
    const ids = instance!.surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
    });
    expect(view.container.querySelector('.docx-remote-caret-label')!.textContent).toBe('BOB');
    await act(async () => {
      view.rerender(<Harness withLabels={false} />);
    });
    const restored = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    expect(restored).toBeTruthy();
    expect(restored!.textContent).toBe('Bob');
    expect(restored!.hasAttribute('data-docx-remote-actor')).toBe(false);
  });

  test('the render-prop colour is the painted label colour for a roster author', async () => {
    const session = stubSession();
    const seenColors: string[] = [];
    const { view, editor } = await mountEditor(
      INS + PLAIN,
      session,
      <DocxEditorCollaboration.CaretLabels session={session}>
        {({ selection, color }) => {
          seenColors.push(color);
          return <span>{selection.name}</span>;
        }}
      </DocxEditorCollaboration.CaretLabels>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      // "Reviewer One" authored the tracked insertion, publishes no colour: presence takes
      // the SAME review-roster slot the review chrome draws them in.
      session.setRemotes([caretOf('a1', 'Reviewer One', ids.at(-1)!)]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    const painted = label!.style.getPropertyValue('--doc-remote-color');
    expect(painted).toBe('var(--doc-review-author-0)');
    expect(seenColors.at(-1)).toBe(painted);
    const rosterInfo = editor()
      .getReviewAuthors()
      .find((info) => info.author === 'Reviewer One');
    expect(rosterInfo?.color).toBe(painted);
  });

  test('a paint that happens inside another component render is not a render-phase update', async () => {
    // The engine repaints whenever something asks it to, and chrome asks during RENDER: the
    // review rail reads the engine while rendering, that read repaints, and the repaint
    // publishes new anchors. Holding the anchors in `useState` made that publish a setState
    // inside a sibling's render — React's "Cannot update a component while rendering a
    // different component", and in production the update it warns about is the one that
    // draws the caret labels.
    const session = stubSession();
    const bytes = docx(PLAIN);
    let instance: DocxEditorInstance | null = null;
    // Stands in for the review rail: it touches the engine during its own render, and that
    // touch repaints. Driving the repaint straight from render is the shortest way to say
    // "a paint happened inside somebody else's render".
    function RepaintsWhileRendering({
      carets,
    }: {
      readonly carets: readonly CollaborationRemoteSelection[];
    }) {
      session.setRemotes(carets);
      session.notify();
      return null;
    }
    function Harness({ carets }: { readonly carets: readonly CollaborationRemoteSelection[] }) {
      return (
        <DocxEditorRoot
          document={bytes}
          modules={[collaborationModule({ session })]}
          onReady={(ready) => {
            instance = ready as DocxEditorInstance;
          }}
        >
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
          <DocxEditorCollaboration.CaretLabels session={session}>
            {({ selection }) => <span data-testid="paint-label">{selection.name}</span>}
          </DocxEditorCollaboration.CaretLabels>
          <RepaintsWhileRendering carets={carets} />
        </DocxEditorRoot>
      );
    }
    const warnings: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ''));
    };
    let view: ReturnType<typeof render>;
    try {
      view = render(<Harness carets={[]} />);
      await act(async () => {});
      const ids = instance!.surface!.session.paragraphIds();
      // The label host is registered now, so this rerender publishes anchors from inside
      // `RepaintsWhileRendering`'s render — the sibling-update React complains about.
      await act(async () => {
        view.rerender(<Harness carets={[caretOf('bob', 'Bob', ids[0]!)]} />);
      });
    } finally {
      console.error = error;
    }
    expect(
      warnings.filter((line) => line.includes('while rendering a different component'))
    ).toEqual([]);
    // And the label still arrives: the fix must cost a render-phase write, not a publish.
    expect(view!.container.querySelector('[data-testid="paint-label"]')?.textContent).toBe('Bob');
  });

  test('the render prop carries the avatar declared for the collaborator by name', async () => {
    const session = stubSession();
    const seen: (string | undefined)[] = [];
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <>
        {/* One declaration, keyed on the display name, is what a comment card resolves too. */}
        <DocxEditorAuthorStyle author="Bob" avatarUrl="/avatars/bob.jpg" />
        <DocxEditorCollaboration.CaretLabels session={session}>
          {({ selection, avatarUrl }) => {
            seen.push(avatarUrl);
            return <span data-testid="declared-label">{selection.name}</span>;
          }}
        </DocxEditorCollaboration.CaretLabels>
      </>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob-1', 'Bob', ids[0]!)]);
      session.notify();
    });
    expect(view.container.querySelector('[data-testid="declared-label"]')).toBeTruthy();
    // Bob has written nothing, so he is in NO review roster: the declaration is what answers.
    expect(
      editor()
        .getReviewAuthors()
        .some((info) => info.author === 'Bob')
    ).toBe(false);
    expect(seen.at(-1)).toBe('/avatars/bob.jpg');
  });

  test('a host component owns the label outright, ignoring every value handed to it', async () => {
    // The label is not a slot for a name and a picture: it is a portal into the host's tree.
    // A renderer may throw away `selection.name`, `color` and `avatarUrl`, keep only the actor
    // id, and resolve everything itself — which is what a host with its own user service and
    // its own design system does.
    const session = stubSession();
    const DIRECTORY = { 'bob-1': { label: 'Bo (Design)', photo: '/team/bo.webp' } };
    function HostCursor({ actorId }: { readonly actorId: string }) {
      const entry = DIRECTORY[actorId as keyof typeof DIRECTORY];
      // Hooks work here, because this renders in the ordinary React tree.
      const pages = useEditorState((state) => state.page.total);
      return (
        <figure data-testid="host-cursor">
          <img src={entry.photo} alt="" />
          <figcaption>{`${entry.label} · p${pages}`}</figcaption>
        </figure>
      );
    }
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.CaretLabels session={session}>
        {({ selection }) => <HostCursor actorId={selection.actorId} />}
      </DocxEditorCollaboration.CaretLabels>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob-1', 'Bob', ids[0]!, '#ff0000')]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    const cursor = label!.querySelector<HTMLElement>('[data-testid="host-cursor"]');
    expect(cursor).toBeTruthy();
    // Neither the published name nor the published colour appears: the host replaced both.
    expect(cursor!.textContent).toBe('Bo (Design) · p1');
    expect(label!.textContent).not.toContain('Bob');
    expect(cursor!.querySelector('img')!.getAttribute('src')).toBe('/team/bo.webp');
    // What the ENGINE still owns: the element, its position, and the colour it resolved —
    // which the host may restyle in CSS but does not render.
    expect(label!.style.getPropertyValue('--doc-remote-color')).toBe('#ff0000');
    expect(label!.style.left).not.toBe('');
  });

  test('a declared colour outranks the one the peer published', async () => {
    // A published colour is remote input: the peer chose it for itself. A declaration is the
    // app's own record of who that person is, so the app wins — otherwise a peer could make
    // their caret disagree with their own comment cards, and "one declaration" would be two
    // values the host has to keep equal by hand.
    const session = stubSession();
    const seen: string[] = [];
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <>
        <DocxEditorAuthorStyle author="Bob" color="#1f7a4d" />
        <DocxEditorCollaboration.CaretLabels session={session}>
          {({ color }) => {
            seen.push(color);
            return <span data-testid="declared-color">{color}</span>;
          }}
        </DocxEditorCollaboration.CaretLabels>
      </>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      // The peer publishes a colour of its own choosing. The declaration overrules it.
      session.setRemotes([caretOf('bob-1', 'Bob', ids[0]!, '#ff0000')]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    expect(label!.style.getPropertyValue('--doc-remote-color')).toBe('#1f7a4d');
    // And chrome reads the painted value back, so the two cannot disagree.
    expect(seen.at(-1)).toBe('#1f7a4d');
  });

  test('the session comes from the editor when no prop names one', async () => {
    // The editor already holds the replica `collaborationModule` contributed, so presence
    // chrome must not have to be handed it. A host with one Root and one room passes nothing.
    const session = stubSession();
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <>
        <DocxEditorCollaboration.CaretLabels />
        <DocxEditorCollaboration.Avatars />
      </>
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setParticipants([participantOf('bob', 'Bob')]);
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
    });
    expect(view.container.querySelector('.docx-remote-caret-label')?.textContent).toBe('Bob');
    expect(view.container.querySelectorAll('[data-collaboration-avatar]').length).toBe(1);
  });

  test('a published colour still wins for an author nobody declared', async () => {
    const session = stubSession();
    const { view, editor } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.CaretLabels session={session} />
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('zoe-1', 'Zoe', ids[0]!, '#ff0000')]);
      session.notify();
    });
    const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label');
    expect(label!.style.getPropertyValue('--doc-remote-color')).toBe('#ff0000');
  });
});

describe('DocxEditorCollaboration.Avatars', () => {
  test('sorts local first then by name, shows initials, and marks the parts', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('c', 'Zoe Quinn'),
      participantOf('b', 'Ada Lovelace', { color: '#aabbcc' }),
      participantOf('a', 'Mina Murray', { isLocal: true }),
    ]);
    const { view } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.Avatars session={session} />
    );
    const stack = view.container.querySelector<HTMLElement>('[data-collaboration-avatars]');
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
    // A published colour wins; it carries no ramp slot.
    expect(avatars[1]!.style.getPropertyValue('--doc-collaboration-accent')).toBe('#aabbcc');
    expect(avatars[1]!.hasAttribute('data-collaboration-author-slot')).toBe(false);
    expect(avatars[0]!.hasAttribute('data-collaboration-author-slot')).toBe(true);
    expect(avatars[0]!.getAttribute('aria-label')).toBe('Mina Murray');
  });

  test('max collapses the overflow into a "+N" chip', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('a', 'Ada', { isLocal: true }),
      participantOf('b', 'Bob'),
      participantOf('c', 'Cleo'),
      participantOf('d', 'Dora'),
    ]);
    const { view } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.Avatars session={session} max={2} />
    );
    const avatars = [
      ...view.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
    ];
    expect(avatars).toHaveLength(3);
    const chip = avatars.at(-1)!;
    expect(chip.hasAttribute('data-overflow')).toBe(true);
    expect(chip.textContent).toBe('+2');
    expect(chip.getAttribute('title')).toBe('2 more people');
  });

  test('a colourless roster author takes the review accent; the render prop matches', async () => {
    const session = stubSession();
    session.setParticipants([
      participantOf('local', 'Someone Else', { isLocal: true, color: '#112233' }),
      participantOf('a1', 'Reviewer One'),
    ]);
    const seen: { name: string; color: string; initials: string }[] = [];
    const { view, editor } = await mountEditor(
      INS + PLAIN,
      session,
      <>
        <DocxEditorCollaboration.Avatars session={session} />
        <DocxEditorCollaboration.Avatars session={session}>
          {({ participant, color, initials }) => {
            seen.push({ name: participant.name, color, initials });
            return <b data-testid="custom-avatar">{initials}</b>;
          }}
        </DocxEditorCollaboration.Avatars>
      </>
    );
    const rosterInfo = editor()
      .getReviewAuthors()
      .find((info) => info.author === 'Reviewer One');
    expect(rosterInfo).toBeTruthy();
    const reviewer = [
      ...view.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
    ].find((avatar) => avatar.title === 'Reviewer One');
    expect(reviewer!.style.getPropertyValue('--doc-collaboration-accent')).toBe(rosterInfo!.color);
    expect(reviewer!.getAttribute('data-collaboration-author-slot')).toBe(
      String(rosterInfo!.slot % 8)
    );
    // The render-prop stack resolved the SAME colours as the packaged one.
    const custom = seen.find((entry) => entry.name === 'Reviewer One');
    expect(custom?.color).toBe(rosterInfo!.color);
    expect(custom?.initials).toBe('RO');
    expect(view.container.querySelectorAll('[data-testid="custom-avatar"]')).toHaveLength(2);
  });

  test('renders nothing without participants', async () => {
    const session = stubSession();
    const { view } = await mountEditor(
      PLAIN,
      session,
      <DocxEditorCollaboration.Avatars session={session} />
    );
    expect(view.container.querySelector('[data-collaboration-avatars]')).toBeNull();
  });

  // A declared review colour is host input in any CSS shape. The paint sink refuses what
  // it cannot paint, so the shared resolution falls to the author's slot token — the
  // painted caret and the avatar must agree either way.
  test('a declared non-hex colour falls to the slot var on caret and avatar alike', async () => {
    const session = stubSession();
    session.setParticipants([participantOf('a1', 'Reviewer One')]);
    const { view, editor } = await mountEditor(
      INS + PLAIN,
      session,
      <DocxEditorCollaboration.Avatars session={session} />
    );
    const paintedAndAvatar = () => {
      const label = view.container.querySelector<HTMLElement>('.docx-remote-caret-label')!;
      const avatar = [
        ...view.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
      ].find((candidate) => candidate.title === 'Reviewer One')!;
      return {
        caret: label.style.getPropertyValue('--doc-remote-color'),
        avatar: avatar.style.getPropertyValue('--doc-collaboration-accent'),
      };
    };
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      editor().setRevisionStyles({ authors: { 'Reviewer One': { color: 'crimson' } } });
      session.setRemotes([caretOf('a1', 'Reviewer One', ids.at(-1)!)]);
      session.notify();
    });
    const refused = paintedAndAvatar();
    expect(refused.caret).toBe('var(--doc-review-author-0)');
    expect(refused.avatar).toBe('var(--doc-review-author-0)');
    await act(async () => {
      editor().setRevisionStyles({ authors: { 'Reviewer One': { color: '#cc0000' } } });
      session.notify();
    });
    const declared = paintedAndAvatar();
    expect(declared.caret).toBe('#cc0000');
    expect(declared.avatar).toBe('#cc0000');
  });

  // Colourless names outside the roster: the ENGINE's stable allocator is the one
  // authority. Session order (Uma before Vic) differs from remote paint order (Vic
  // first); pre-unification the avatars recomputed by session order while the carets
  // allocated by first resolution, and the two could swap colours.
  test('unknown colourless participants take the painted caret colours', async () => {
    const session = stubSession();
    session.setParticipants([participantOf('u1', 'Uma'), participantOf('u2', 'Vic')]);
    const { view, editor } = await mountEditor(
      PLAIN + PLAIN,
      session,
      <DocxEditorCollaboration.Avatars session={session} />
    );
    const ids = editor().surface!.session.paragraphIds();
    await act(async () => {
      // Paint order deliberately differs from session order.
      session.setRemotes([caretOf('u2', 'Vic', ids[1]!), caretOf('u1', 'Uma', ids[0]!)]);
      session.notify();
    });
    const labels = [...view.container.querySelectorAll<HTMLElement>('.docx-remote-caret-label')];
    const caretColor = (name: string) =>
      labels
        .find((label) => label.textContent === name)!
        .style.getPropertyValue('--doc-remote-color');
    const avatars = [
      ...view.container.querySelectorAll<HTMLElement>('[data-collaboration-avatar]'),
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
  });
});

describe('DocxEditorCollaborationRoot', () => {
  test('writes the key, the document and the modules, and names the author from the room', async () => {
    // The three props that fail QUIETLY when a host writes them by hand, plus the fourth
    // value that drifts when it is set apart: `author` is what the SAVED FILE keeps, so a
    // comment signed with one name while the room showed another is a bug the document
    // carries for good.
    const session = stubSession();
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorCollaborationRoot
        collaboration={{
          document: docx(PLAIN),
          modules: [collaborationModule({ session })],
          session,
        }}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        {/* No `session` prop: the parts read it from the editor this component mounted. */}
        <DocxEditorCollaboration.CaretLabels />
      </DocxEditorCollaborationRoot>
    );
    await act(async () => {});

    // The document opened, and the module attached — which is what the `key` buys.
    expect(instance).not.toBeNull();
    expect(instance!.getConfiguredAuthor()).toBe('Local');

    const ids = instance!.surface!.session.paragraphIds();
    await act(async () => {
      session.setRemotes([caretOf('bob', 'Bob', ids[0]!)]);
      session.notify();
    });
    expect(view.container.querySelector('.docx-remote-caret-label')?.textContent).toBe('Bob');
  });

  test('renders the fallback until the room has a document', async () => {
    const view = render(
      <DocxEditorCollaborationRoot
        collaboration={{ document: null, modules: [], session: null }}
        fallback={<p data-testid="connecting">Connecting…</p>}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorCollaborationRoot>
    );
    await act(async () => {});
    expect(view.container.querySelector('[data-testid="connecting"]')).toBeTruthy();
    expect(view.container.querySelector('.docx-paginated-surface')).toBeNull();
  });
});
