// Shared adapter DOM event bridge (interactive-paginated-editing M2.1).
//
// The one place a native browser event becomes an InteractionIntent. React and
// Vue both attach this bridge and add no event normalization of their own, so
// the two adapters cannot drift in click counting, modifier policy, or which
// keys the engine claims.
//
// Boundaries this module keeps:
//   - It reads only what a pointer/keyboard event reports about itself. It never
//     measures the document, walks painted DOM, or derives geometry; client
//     coordinates are forwarded untouched and converted by the engine.
//   - Intents stay serializable — no DOM object, no framework type, ever ends up
//     on an intent.
//   - Host effects (pointer capture, scroll) are applied here because they are
//     the host's business; the engine only asks.

import type {
  InteractionDispatchResult,
  InteractionFrameId,
  InteractionIntent,
} from '@docx-editor.dev/core-contract/interaction';

/** The subset of an element the bridge needs; satisfied by HTMLElement. */
export interface BridgeElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a real
  // HTMLElement's overloaded listener signature must satisfy this shape.
  addEventListener(type: string, listener: (event: any) => void, options?: any): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: any): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  scrollBy?(options: { left: number; top: number }): void;
}

/** The public editor surface the bridge talks to — no engine internals. */
export interface BridgeEditorPort {
  /** Current frame identity, or null when no frame is published yet. */
  getInteractionFrameId(): InteractionFrameId | null;
  dispatchInteraction(intent: InteractionIntent): InteractionDispatchResult;
}

/** The pointer-event fields the bridge reads. */
export interface BridgePointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId?: number;
  readonly button?: number;
  readonly buttons?: number;
  readonly detail?: number;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  preventDefault(): void;
}

/** The keyboard-event fields the bridge reads. */
export interface BridgeKeyboardEvent {
  readonly key: string;
  stopPropagation(): void;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  preventDefault(): void;
}

export interface KeyboardModifiers {
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/** Keys whose meaning is a position on the painted page, so the engine owns them. */
const GEOMETRY_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Map a native `detail` count into the 1..3 range the planner accepts. A fourth
 * rapid click restarts the cycle rather than being clamped to triple-click,
 * which is what Word does and what stops a held-down click selecting the block
 * forever.
 */
export function normalizeClickCount(detail: number | undefined): number {
  if (typeof detail !== 'number' || !Number.isFinite(detail) || detail < 1) return 1;
  const cycled = (Math.floor(detail) - 1) % 3;
  return cycled + 1;
}

/**
 * Decide who owns a key. Geometry keys go to the engine planner; everything
 * else — text, Backspace, Delete, Enter, Tab, and every ctrl/meta/alt shortcut —
 * stays with the hidden ProseMirror input host, which is the editing engine.
 */
export function keyboardIntentKind(key: string, modifiers: KeyboardModifiers): 'geometryKeyboard' | 'native' {
  if (!GEOMETRY_KEYS.has(key)) return 'native';
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return 'native';
  return 'geometryKeyboard';
}

/** Pointer travel that turns a press into a drag rather than a click. */
const DRAG_SLOP_PX = 3;

function movedBeyondSlop(press: { x: number; y: number }, event: BridgePointerEvent): boolean {
  return Math.abs(event.clientX - press.x) > DRAG_SLOP_PX || Math.abs(event.clientY - press.y) > DRAG_SLOP_PX;
}

/**
 * A real `pointermove` reports `button: -1` — "no button changed since the last
 * event" — not `0`. Rejecting that as non-primary silently drops every move in a
 * drag, which leaves the range unextended and lets the trailing click collapse
 * the selection. Only a positive, non-primary button is rejected.
 */
function isPrimaryPointer(event: BridgePointerEvent): boolean {
  if (event.button !== undefined && event.button > 0) return false;
  if (event.buttons !== undefined && (event.buttons & ~1) !== 0) return false;
  return true;
}

function modifiersOf(event: BridgePointerEvent | BridgeKeyboardEvent) {
  return {
    shiftKey: event.shiftKey === true,
    ctrlKey: event.ctrlKey === true,
    metaKey: event.metaKey === true,
    altKey: event.altKey === true,
  };
}

function applyHostEffects(element: BridgeElement, result: InteractionDispatchResult): void {
  for (const effect of result.hostEffects) {
    switch (effect.kind) {
      case 'capturePointer':
        element.setPointerCapture?.(effect.pointerId);
        break;
      case 'releasePointer':
        element.releasePointerCapture?.(effect.pointerId);
        break;
      case 'scroll':
        element.scrollBy?.({ left: effect.delta.x, top: effect.delta.y });
        break;
    }
  }
}

const POINTER_KINDS = {
  pointerdown: 'pointerDown',
  pointermove: 'pointerMove',
  pointerup: 'pointerUp',
  pointercancel: 'pointerCancel',
  click: 'click',
} as const;

/**
 * Attach the bridge to a host element. Returns a disposer that removes every
 * listener it added; calling it twice is safe.
 */
export function attachAdapterEventBridge(element: BridgeElement, port: BridgeEditorPort): () => void {
  const registered: { type: string; listener: (event: any) => void; capture: boolean }[] = [];

  // A drag ends with the browser firing `click` on top of `pointerup`. Forwarding
  // that click would place a collapsed caret and wipe the range the user just
  // dragged, so a click that concludes a drag is swallowed. Movement is measured
  // in client pixels from the press, with a small slop so a shaky click still
  // counts as a click.
  let pressPoint: { x: number; y: number } | null = null;
  let pointerDragged = false;

  function on(type: string, listener: (event: any) => void, capture = false): void {
    element.addEventListener(type, listener, capture ? { capture: true } : undefined);
    registered.push({ type, listener, capture });
  }

  function dispatch(intent: InteractionIntent): InteractionDispatchResult | null {
    const result = port.dispatchInteraction(intent);
    applyHostEffects(element, result);
    return result;
  }

  for (const [domType, intentKind] of Object.entries(POINTER_KINDS)) {
    on(domType, (event: BridgePointerEvent) => {
      const frameId = port.getInteractionFrameId();
      if (!frameId) return;
      // pointercancel carries no button state worth filtering; every other
      // pointer phase must be a primary-button gesture.
      if (domType !== 'pointercancel' && !isPrimaryPointer(event)) return;

      if (domType === 'pointerdown') {
        pressPoint = { x: event.clientX, y: event.clientY };
        pointerDragged = false;
      } else if (domType === 'pointermove' && pressPoint) {
        if (movedBeyondSlop(pressPoint, event)) pointerDragged = true;
      } else if (domType === 'click') {
        const concludedDrag = pointerDragged;
        pressPoint = null;
        pointerDragged = false;
        if (concludedDrag) return;
      }

      dispatch({
        kind: intentKind,
        frameId,
        clientPoint: { x: event.clientX, y: event.clientY },
        ...(event.pointerId === undefined ? {} : { pointerId: event.pointerId }),
        ...(domType === 'click' ? { clickCount: normalizeClickCount(event.detail) } : {}),
        ...modifiersOf(event),
      } as InteractionIntent);
    });
  }

  // CAPTURE phase, deliberately. ProseMirror's own keymap is installed on
  // `view.dom`, which is a DESCENDANT of this element, so a bubble-phase
  // listener here runs AFTER PM has already handled the key. Independent review
  // measured the consequence: with the caret at grapheme 3, one ArrowRight that
  // the engine refused left PM's head at 4 while the painted caret stayed at 3 —
  // the real insertion point sitting somewhere the user cannot see, so the next
  // character lands in the wrong place. Capture runs ancestor-to-target, so the
  // engine is consulted first.
  on(
    'keydown',
    (event: BridgeKeyboardEvent) => {
      const frameId = port.getInteractionFrameId();
      if (!frameId) return;
      if (keyboardIntentKind(event.key, modifiersOf(event)) !== 'geometryKeyboard') return;

      // Claim the key before anything downstream can act on it. The engine is
      // the only geometry authority, so for the keys it owns the answer is
      // either "the engine moved the caret" or "nothing happens" — never
      // "something else moved the caret invisibly".
      //
      // This reverses an earlier decision. The previous comment read "a rejected
      // navigation must fall through to native handling rather than
      // dead-ending", but native handling here IS ProseMirror moving a caret the
      // engine cannot paint. An inert key is strictly safer than an invisible
      // one.
      event.preventDefault();
      event.stopPropagation();

      dispatch({
        kind: 'geometryKeyboard',
        frameId,
        key: event.key,
        ...modifiersOf(event),
      });
    },
    true,
  );

  on('focusin', () => {
    const frameId = port.getInteractionFrameId();
    if (!frameId) return;
    dispatch({ kind: 'focus', frameId });
  });

  on('focusout', () => {
    const frameId = port.getInteractionFrameId();
    if (!frameId) return;
    dispatch({ kind: 'blur', frameId });
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // Removal must pass the same capture flag the listener was added with, or
    // the listener survives the disposer.
    for (const { type, listener, capture } of registered) {
      element.removeEventListener(type, listener, capture ? { capture: true } : undefined);
    }
    registered.length = 0;
  };
}
