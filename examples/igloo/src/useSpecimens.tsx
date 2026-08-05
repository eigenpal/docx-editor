// Every specimen action, in one place, behind a context.
//
// Four surfaces reach these: the Igloo menu, the right-click menu, the chip itself, and the
// context menu's Edit row. `useFrost` makes the same argument for one shared definition of a
// host action — a toolbar and a menu that each decide independently when an action is
// available will eventually disagree — and this is that rule with UI state attached, so the
// dialog, the popover and the notice have exactly one owner.
//
// It also holds the mount point the pro chrome needs: `CustomNodeChrome` (chip tint and
// click delegation) belongs inside `DocxEditor.Root`, and it is rendered here beside the
// state its `onNodeClick` drives.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import { insertCustomNode, updateCustomNode, type ActivatedCustomNode } from '@docx-editor.dev/pro';
import { CustomNodeChrome } from '@docx-editor.dev/pro/react';
import {
  blocksOf,
  defaultAttrs,
  definitionOf,
  depthOf,
  labelFor,
  randomSpecimen,
  type SpecimenAt,
  type SpecimenKind,
} from './specimens';
import { SpecimenDialog, type SpecimenForm } from './SpecimenDialog';
import { SpecimenPopover, type SpecimenProbe } from './SpecimenPopover';

/**
 * What the node APIs return. Structurally the engine's `ExecResult` — a refusal carries the
 * ENGINE's own reason (tag overflow, offset out of range, a locked control), and showing
 * that beats inventing one.
 */
type Refusable = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface SpecimenActions {
  /** Whether the ENGINE would take a write right now. A view-only document reports false. */
  readonly editable: boolean;
  /**
   * Why not, when `editable` is false.
   *
   * A greyed row with no explanation is the thing this codebase does not ship. There is no
   * `Editor.can` for a node write — `insertCustomNode` reports its refusal only after the
   * fact — so this says which of the two causes it is rather than inventing a third.
   */
  readonly disabledReason: string | null;
  /** Open the authoring form, on the caret it was opened from. */
  readonly compose: (kind: SpecimenKind) => void;
  /** One specimen picked out of the water, straight into the document. */
  readonly dropRandom: () => void;
  /** Re-author an existing node — what the context menu's Edit row runs. */
  readonly edit: (node: ActivatedCustomNode) => void;
}

const SpecimenContext = createContext<SpecimenActions | null>(null);

/** Inert outside the provider, so a part rendered by mistake shows nothing rather than throws. */
const INERT: SpecimenActions = {
  editable: false,
  disabledReason: null,
  compose: () => {},
  dropRandom: () => {},
  edit: () => {},
};

export function useSpecimens(): SpecimenActions {
  return useContext(SpecimenContext) ?? INERT;
}

/** A notice keyed by its own id, so the same words twice still replay the fade. */
interface Notice {
  readonly id: number;
  readonly text: string;
}

/**
 * Mount inside `DocxEditor.Root`.
 *
 * Renders the chip chrome, the authoring dialog, the specimen popover and the notice strip,
 * and provides the actions the menus call.
 */
export function SpecimenProvider({ children }: { children: ReactNode }) {
  const editor = useDocxEditor();
  const editable = useEditorState((snapshot) => snapshot.editable);
  // Read separately so a refusal can name its cause. `editable` folds "read-only document"
  // and "Viewing mode" into one boolean, and those are two different things to tell somebody.
  const mode = useEditorState((snapshot) => snapshot.editingMode);
  const [form, setForm] = useState<SpecimenForm | null>(null);
  const [probe, setProbe] = useState<SpecimenProbe | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /**
   * The caret AT THE MOMENT THE ROW IS CHOSEN.
   *
   * A menu row that opens a dialog and then inserts "wherever the selection is by now" lands
   * the specimen wherever the user's last click left it, which is rarely where they were
   * reading. `at` on the insert is exactly this problem's answer.
   */
  const caret = useCallback(
    (): SpecimenAt => editor?.surface?.state().selection.head ?? null,
    [editor]
  );

  const say = useCallback((text: string) => {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);

  const report = useCallback(
    (result: Refusable, done: string) => {
      say(result.ok ? done : `Refused: ${result.reason}`);
    },
    [say]
  );

  const place = useCallback(
    (kind: SpecimenKind, attrs: Record<string, string>, label: string, at: SpecimenAt) => {
      if (!editor) return;
      const definition = definitionOf(kind);
      report(
        insertCustomNode(editor, definition, attrs, label, {
          alias: definition.label ?? definition.name,
          ...(at ? { at } : {}),
        }),
        kind === 'iceberg' ? 'A berg calved into the paragraph.' : 'An igloo went up.'
      );
    },
    [editor, report]
  );

  const compose = useCallback(
    (kind: SpecimenKind) => {
      const attrs = defaultAttrs(kind);
      setForm({ mode: 'insert', kind, attrs, label: labelFor(kind, attrs), at: caret() });
    },
    [caret]
  );

  const dropRandom = useCallback(() => {
    const picked = randomSpecimen();
    place(picked.kind, picked.attrs, picked.label, caret());
  }, [caret, place]);

  const edit = useCallback(
    (node: ActivatedCustomNode) => {
      // `nodeId` is present when the activation could be resolved against the review
      // module's queue. Without it there is no address to re-author, and saying so beats a
      // dialog whose Save can only fail.
      if (node.nodeId === undefined) {
        say('That specimen has no id to re-author yet.');
        return;
      }
      const kind: SpecimenKind = node.name === 'iceberg' ? 'iceberg' : 'igloo';
      setForm({
        mode: 'edit',
        kind,
        nodeId: node.nodeId,
        attrs: { ...node.attrs },
        label: node.text ?? labelFor(kind, node.attrs),
      });
    },
    [say]
  );

  /**
   * The chip click, and the funny half of both definitions.
   *
   * An ICEBERG surfaces what is under it — read-only, a popover over the chip. An IGLOO lays
   * another block, which is a REAL document write (`updateCustomNode` removes and reinserts
   * at the node's own span in one transaction, one undo step), so the label in the paragraph,
   * the rail card and the saved file all move together.
   */
  const activate = useCallback(
    (node: ActivatedCustomNode) => {
      if (node.name === 'iceberg') {
        setProbe({ kind: 'iceberg', rect: node.rect, depth: depthOf(node.attrs) });
        return;
      }
      const blocks = blocksOf(node.attrs) + 1;
      if (!editor || node.nodeId === undefined) {
        say('That igloo has no id to build on yet.');
        return;
      }
      const attrs = { blocks: String(blocks) };
      const result = updateCustomNode(
        editor,
        definitionOf('igloo'),
        node.nodeId,
        attrs,
        labelFor('igloo', attrs),
        { alias: 'Igloo' }
      );
      if (!result.ok) {
        report(result, '');
        return;
      }
      setProbe({ kind: 'igloo', rect: node.rect, blocks });
    },
    [editor, report, say]
  );

  const value = useMemo<SpecimenActions>(
    () => ({
      editable,
      disabledReason: editable
        ? null
        : mode === 'viewing'
          ? 'Viewing mode — switch to Editing or Suggesting'
          : 'this document is read-only',
      compose,
      dropRandom,
      edit,
    }),
    [editable, mode, compose, dropRandom, edit]
  );

  const commit = useCallback(
    (next: SpecimenForm) => {
      setForm(null);
      if (!editor) return;
      if (next.mode === 'insert') {
        place(next.kind, next.attrs, next.label, next.at);
        return;
      }
      const definition = definitionOf(next.kind);
      report(
        updateCustomNode(editor, definition, next.nodeId, next.attrs, next.label, {
          alias: definition.label ?? definition.name,
        }),
        'Re-carved.'
      );
    },
    [editor, place, report]
  );

  return (
    <SpecimenContext.Provider value={value}>
      {/* Definition-driven chip tint and click delegation, from the pro package. It defaults
          to the definitions registered on the Root, so nothing is listed twice. */}
      <CustomNodeChrome onNodeClick={activate} />
      {children}
      {form ? <SpecimenDialog form={form} onCommit={commit} onClose={() => setForm(null)} /> : null}
      {probe ? <SpecimenPopover probe={probe} onClose={() => setProbe(null)} /> : null}
      {notice ? (
        <div
          key={notice.id}
          className="igloo-notice"
          role="status"
          onAnimationEnd={() => setNotice(null)}
        >
          {notice.text}
        </div>
      ) : null}
    </SpecimenContext.Provider>
  );
}
