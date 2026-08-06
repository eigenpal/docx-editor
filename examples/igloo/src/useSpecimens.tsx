// Every specimen action, in one place, behind a context.
//
// Four surfaces reach these: the Igloo menu, the right-click menu, the chip itself and the
// context menu's Edit row. One owner for the dialog, the popover and the notice, for the same
// reason `useFrost` has one definition — surfaces that decide independently drift apart.
//
// It also mounts `CustomNodeChrome`, which belongs inside `DocxEditor.Root` and drives its
// `onNodeClick` from the state held here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDocxEditor, useEditorCaret, useEditorState } from '@docx-editor.dev/react';
import { insertCustomNode, updateCustomNode, type ActivatedCustomNode } from '@docx-editor.dev/pro';
import { CustomNodeChrome } from '@docx-editor.dev/pro/react';
import {
  blocksOf,
  defaultAttrs,
  IcebergData,
  definitionOf,
  depthOf,
  labelFor,
  payloadFor,
  randomSpecimen,
  tagAttrsFor,
  type SpecimenAt,
  type SpecimenKind,
} from './specimens';
import { SpecimenDialog, type SpecimenForm } from './SpecimenDialog';
import { SpecimenPopover, type SpecimenProbe } from './SpecimenPopover';

/** Structurally the engine's `ExecResult`: a refusal carries the engine's own reason. */
type Refusable = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface SpecimenActions {
  /** Whether the ENGINE would take a write right now. A view-only document reports false. */
  readonly editable: boolean;
  /**
   * Why not, when `editable` is false. There is no `Editor.can` for a node write, so this is
   * the host's own sentence; the engine's verbatim refusal arrives in the notice on attempt.
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

/** Inert outside the provider: a part rendered by mistake shows nothing rather than throwing. */
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
  // Separate, because `editable` folds "read-only" and "Viewing mode" into one boolean and
  // those are two different things to tell somebody.
  const mode = useEditorState((snapshot) => snapshot.editingMode);
  const [form, setForm] = useState<SpecimenForm | null>(null);
  const [probe, setProbe] = useState<SpecimenProbe | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // The caret at the moment a row is chosen. A dialog takes focus, so inserting at "wherever
  // the selection is by then" lands the specimen wherever the last click left it.
  //
  // Read through a REF at call time, not closed over: the caret moves on every keystroke,
  // and actions whose identities followed it rebuilt the context value — and with it the
  // whole menu tree of every consumer — once per typed character. The handlers only need
  // the caret at the moment they run, which is exactly what a ref carries.
  const caret = useEditorCaret();
  const caretRef = useRef(caret);
  caretRef.current = caret;

  const say = useCallback((text: string) => {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);

  // The fade animation's `onAnimationEnd` is the primary dismissal; this is the fallback
  // for environments where it never fires (reduced motion, a hidden tab's throttled
  // rendering) — a status pill must not outlive its moment.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      // The tag carries identity; the iceberg's depth goes to the payload beside it, in the
      // same transaction. `payloadFor` answers undefined for the igloo, which keeps its one
      // small number in the tag where it fits.
      const data = payloadFor(kind, attrs);
      report(
        insertCustomNode(editor, definition, {
          alias: definition.label ?? definition.name,
          // The berg is derived from its record by `toDocx`; the igloo has no payload, so it
          // passes the tag attrs and the words it wants.
          ...(data ? { data } : { attrs: tagAttrsFor(kind, attrs), text: label }),
          ...(at ? { at } : {}),
        }),
        kind === 'iceberg' ? 'A berg calved into the paragraph.' : 'An igloo went up.'
      );
    },
    [editor, report]
  );

  const compose = useCallback((kind: SpecimenKind) => {
    const attrs = defaultAttrs(kind);
    setForm({ mode: 'insert', kind, attrs, label: labelFor(kind, attrs), at: caretRef.current });
  }, []);

  const dropRandom = useCallback(() => {
    const picked = randomSpecimen();
    place(picked.kind, picked.attrs, picked.label, caretRef.current);
  }, [place]);

  const edit = useCallback(
    (node: ActivatedCustomNode) => {
      // `nodeId` resolves only against a registered review module. Without it there is no
      // address to re-author, and saying so beats a dialog whose Save can only fail.
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
   * The chip click. An iceberg surfaces what is under it; an igloo lays another block, which
   * is a real `updateCustomNode` write — one transaction, one undo step, so the paragraph
   * label, the rail card and the saved file move together.
   */
  const activate = useCallback(
    (node: ActivatedCustomNode) => {
      if (node.name === 'iceberg') {
        const survey = IcebergData.safeParse(node.data);
        setProbe({
          kind: 'iceberg',
          rect: node.rect,
          depth: survey.success ? survey.data.depth : depthOf(node.attrs),
          ...(survey.success && survey.data.surveyedBy
            ? { surveyedBy: survey.data.surveyedBy }
            : {}),
          ...(survey.success && survey.data.notes ? { notes: survey.data.notes } : {}),
        });
        return;
      }
      const blocks = blocksOf(node.attrs) + 1;
      if (!editor || node.nodeId === undefined) {
        say('That igloo has no id to build on yet.');
        return;
      }
      const attrs = { blocks: String(blocks) };
      const result = updateCustomNode(editor, definitionOf('igloo'), node.nodeId, { attrs: attrs, text: labelFor('igloo', attrs), alias: 'Igloo' });
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
          ? 'Viewing mode: switch to Editing or Suggesting'
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
      } else {
        const definition = definitionOf(next.kind);
        const data = payloadFor(next.kind, next.attrs);
        report(
          updateCustomNode(editor, definition, next.nodeId, {
            alias: definition.label ?? definition.name,
            ...(data ? { data } : { attrs: tagAttrsFor(next.kind, next.attrs), text: next.label }),
          }),
          'Re-carved.'
        );
      }
      // Back to the document, the way the packaged compose box returns focus: the dialog
      // took it, and without this the writer lands on `body` with Tab restarting at the top.
      editor.focus();
    },
    [editor, place, report]
  );

  // Stable, so the dialog's and popover's document-level listener effects bind once per
  // open rather than re-subscribing on every provider render.
  const closeDialog = useCallback(() => {
    setForm(null);
    editor?.focus();
  }, [editor]);
  const closePopover = useCallback(() => setProbe(null), []);

  return (
    <SpecimenContext.Provider value={value}>
      {/* Chip tint and click delegation. Defaults to the definitions registered on the Root. */}
      <CustomNodeChrome onNodeClick={activate} />
      {children}
      {/* KEYED by what is being authored: the fields are seeded from `form` at mount, and
          the key guarantees a different target never reuses a mounted dialog's state —
          without it, an edit reached while another edit was open would show the previous
          node's fields and save them to the new nodeId. */}
      {form ? (
        <SpecimenDialog
          key={form.mode === 'edit' ? form.nodeId : 'insert'}
          form={form}
          onCommit={commit}
          onClose={closeDialog}
        />
      ) : null}
      {probe ? <SpecimenPopover probe={probe} onClose={closePopover} /> : null}
      {/* The live region is PERSISTENT and the notice swaps inside it: a `role="status"`
          element inserted already holding its text is unreliably announced, and this one
          was also remounted per notice to replay the fade. The inner key keeps the replay;
          the region keeps the announcement. */}
      <div role="status" className="igloo-notice-region">
        {notice ? (
          <div key={notice.id} className="igloo-notice" onAnimationEnd={() => setNotice(null)}>
            {notice.text}
          </div>
        ) : null}
      </div>
    </SpecimenContext.Provider>
  );
}
