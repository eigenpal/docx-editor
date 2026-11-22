// The copy, cut and paste refusals that adapters show to the reader.
//
// The engine refuses a clipboard action on a drawing or a chart with a sentence that names
// what to do instead, such as "this shape has no text to paste into". The refusal goes to
// `snapshot().lastRejection` only, so a keyboard paste on a selected shape did nothing visible.
// Adapters show these refusals in the same dialog as a refused picture insert.
//
// Only the drawing and chart clipboard sentences show. A refusal in text, such as a locked
// content control, comes from the same store checks as typing, and typing refusals stay silent.
// The refusal counter selects the refusal of this one action, so an earlier action's reason,
// still in the snapshot, never shows again.

import type { EditorCommand } from '../contracts/editor.ts';
import type { ExecResult } from '../contracts/types.ts';
import { CHART_CLIPBOARD_STALE_REASON } from './chart-clipboard.ts';
import { CHART_CLIPBOARD_REASON } from './clipboard-object-selection.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import { hostWindowOf, type HostWindow } from './host-realm.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { DRAWING_CLIPBOARD_REASONS } from './surface-drawing-clipboard.ts';

/**
 * A clipboard action. A paste without formatting is a `paste`.
 *
 * @internal
 */
export type ClipboardAction = 'copy' | 'cut' | 'paste';

/**
 * A refused clipboard action to show: the action, and the engine's reason. Translate the
 * reason with `localizeDisabledReason` from `@docx-editor.dev/i18n`.
 *
 * @internal
 */
export interface ClipboardRefusal {
  /** The refused action, which names the dialog title. */
  readonly action: ClipboardAction;
  /** The engine's reason, a key of `DISABLED_REASON_KEYS`. */
  readonly reason: string;
}

const CLIPBOARD_ACTIONS: readonly ClipboardAction[] = ['copy', 'cut', 'paste'];

/** The clipboard refusals that a reader sees. Each one has a translation key. */
const SHOWN_REASONS: ReadonlySet<string> = new Set([
  ...DRAWING_CLIPBOARD_REASONS,
  CHART_CLIPBOARD_REASON,
  CHART_CLIPBOARD_STALE_REASON,
]);

/**
 * The reason, when it is a clipboard refusal that adapters show, or null.
 *
 * @internal
 */
export function shownClipboardRefusal(reason: string | null | undefined): string | null {
  return reason && SHOWN_REASONS.has(reason) ? reason : null;
}

function clipboardActionOf(command: EditorCommand): ClipboardAction | null {
  switch (command.type) {
    case 'copy':
    case 'cut':
    case 'paste':
      return command.type;
    case 'pasteWithoutFormatting':
      return 'paste';
    default:
      return null;
  }
}

/**
 * The refusal to show for a copy, cut or paste command that `exec` refused, such as a
 * context-menu Paste. Null for a command that succeeded, for any other command, and for a
 * refusal that adapters do not show (see {@link shownClipboardRefusal}).
 *
 * @internal
 */
export function clipboardCommandRefusal(
  command: EditorCommand,
  result: ExecResult | undefined
): ClipboardRefusal | null {
  if (!result || result.ok) return null;
  const action = clipboardActionOf(command);
  const reason = action ? shownClipboardRefusal(result.reason) : null;
  return action && reason ? { action, reason } : null;
}

/** One clipboard event in progress: the surface it reached and its refusal count before. */
interface PendingAction {
  readonly event: Event;
  readonly surface: PaginatedSurface;
  readonly before: number;
}

/**
 * Show the refusals of the copy, cut and paste events that reach `element` or its
 * descendants. Bind the element that holds the painted pages and the drawing selection
 * overlay. The editor runs each event; this reads only the refusal that the event itself
 * published, and calls `show` once for it when adapters show it
 * (see {@link shownClipboardRefusal}). An event that published no refusal, or a refusal
 * from an earlier action, calls nothing.
 *
 * The count is read in the capture phase, before the editor runs the event, and the refusal
 * in the bubble phase, after it. A handler that stops the event's propagation inside the
 * element is read on the next task instead.
 *
 * @returns The function that removes the listeners.
 * @internal
 */
export function watchClipboardRefusals(
  element: HTMLElement,
  editor: Pick<DocxEditorInstance, 'surface'>,
  show: (refusal: ClipboardRefusal) => void
): () => void {
  let pending: PendingAction | null = null;
  let timer: { readonly win: HostWindow; readonly id: number } | null = null;
  const stopTimer = (): void => {
    if (timer !== null) timer.win.clearTimeout(timer.id);
    timer = null;
  };
  const settle = (event: Event | null): void => {
    const action = pending;
    if (!action || (event && action.event !== event)) return;
    pending = null;
    stopTimer();
    const reason = shownClipboardRefusal(action.surface.refusalSince(action.before));
    if (reason) show({ action: action.event.type as ClipboardAction, reason });
  };
  const onCapture = (event: Event): void => {
    settle(null);
    const surface = editor.surface;
    if (!surface) return;
    pending = { event, surface, before: surface.refusalCount() };
    const win = hostWindowOf(element);
    timer = { win, id: win.setTimeout(() => settle(null), 0) };
  };
  const onBubble = (event: Event): void => settle(event);
  for (const type of CLIPBOARD_ACTIONS) {
    element.addEventListener(type, onCapture, { capture: true });
    element.addEventListener(type, onBubble);
  }
  return () => {
    for (const type of CLIPBOARD_ACTIONS) {
      element.removeEventListener(type, onCapture, { capture: true });
      element.removeEventListener(type, onBubble);
    }
    stopTimer();
    pending = null;
  };
}
