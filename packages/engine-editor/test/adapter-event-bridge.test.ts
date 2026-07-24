// Shared adapter event bridge (interactive-paginated-editing M2.1).

import { describe, expect, test } from 'bun:test';
import type {
  InteractionDispatchResult,
  InteractionFrameId,
  InteractionIntent,
} from '@docx-editor.dev/core-contract/interaction';
import {
  attachAdapterEventBridge,
  keyboardIntentKind,
  normalizeClickCount,
  type BridgeElement,
  type BridgeEditorPort,
  type BridgeKeyboardEvent,
  type BridgePointerEvent,
} from '../src/adapter-event-bridge.ts';

type Listener = (event: unknown) => void;

class FakeElement implements BridgeElement {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured: number[] = [];
  readonly released: number[] = [];
  readonly scrolled: { x: number; y: number }[] = [];

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.released.push(pointerId);
  }

  scrollBy(options: { left: number; top: number }): void {
    this.scrolled.push({ x: options.left, y: options.top });
  }

  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

const FRAME_ID: InteractionFrameId = { value: 7 };

function okResult(): InteractionDispatchResult {
  return { outcome: { ok: true, value: undefined, frameId: FRAME_ID }, hostEffects: [] };
}

function fakePort(
  overrides: Partial<BridgeEditorPort> = {},
): BridgeEditorPort & { readonly intents: InteractionIntent[] } {
  const intents: InteractionIntent[] = [];
  return {
    intents,
    getInteractionFrameId: () => FRAME_ID,
    dispatchInteraction: (intent: InteractionIntent) => {
      intents.push(intent);
      return okResult();
    },
    ...overrides,
  } as BridgeEditorPort & { readonly intents: InteractionIntent[] };
}

function pointerEvent(overrides: Partial<BridgePointerEvent> = {}): BridgePointerEvent & { defaultPrevented: boolean } {
  let defaultPrevented = false;
  return {
    clientX: 100,
    clientY: 200,
    pointerId: 1,
    button: 0,
    buttons: 1,
    detail: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    ...overrides,
  } as BridgePointerEvent & { defaultPrevented: boolean };
}

function keyEvent(key: string, overrides: Partial<BridgeKeyboardEvent> = {}) {
  let defaultPrevented = false;
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    ...overrides,
  } as BridgeKeyboardEvent & { defaultPrevented: boolean };
}

describe('adapter event bridge normalizers (task M2.1)', () => {
  test('click count is normalized into the planner-accepted 1..3 range', () => {
    expect(normalizeClickCount(1)).toBe(1);
    expect(normalizeClickCount(2)).toBe(2);
    expect(normalizeClickCount(3)).toBe(3);
    // A fast quadruple click reports detail 4; Word restarts the cycle at 1.
    expect(normalizeClickCount(4)).toBe(1);
    expect(normalizeClickCount(5)).toBe(2);
    expect(normalizeClickCount(0)).toBe(1);
    expect(normalizeClickCount(Number.NaN)).toBe(1);
    expect(normalizeClickCount(-3)).toBe(1);
  });

  test('geometry keys route to the engine and text keys stay with the input host', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(keyboardIntentKind(key, {})).toBe('geometryKeyboard');
    }
    for (const key of ['a', 'Backspace', 'Delete', 'Enter', 'Tab', 'z', ' ']) {
      expect(keyboardIntentKind(key, {})).toBe('native');
    }
  });

  test('shortcut modifiers keep geometry keys away from the engine planner', () => {
    // Ctrl/Meta arrow combinations are word-jump and browser shortcuts; the
    // planner rejects modified navigation, so they must not be claimed here.
    expect(keyboardIntentKind('ArrowLeft', { ctrlKey: true })).toBe('native');
    expect(keyboardIntentKind('ArrowLeft', { metaKey: true })).toBe('native');
    expect(keyboardIntentKind('ArrowLeft', { altKey: true })).toBe('native');
    expect(keyboardIntentKind('ArrowLeft', { shiftKey: true })).toBe('geometryKeyboard');
  });
});

describe('adapter event bridge wiring (task M2.1)', () => {
  test('pointer and click events dispatch frame-bound intents with client coordinates', () => {
    const element = new FakeElement();
    const port = fakePort();
    attachAdapterEventBridge(element, port);

    element.emit('pointerdown', pointerEvent({ clientX: 10, clientY: 20, pointerId: 3 }));
    element.emit('pointermove', pointerEvent({ clientX: 11, clientY: 25, pointerId: 3 }));
    element.emit('pointerup', pointerEvent({ clientX: 12, clientY: 30, pointerId: 3 }));
    element.emit('click', pointerEvent({ clientX: 12, clientY: 30, detail: 1 }));

    expect(port.intents.map((i) => i.kind)).toEqual(['pointerDown', 'pointerMove', 'pointerUp', 'click']);
    for (const intent of port.intents) {
      expect(intent.frameId).toEqual(FRAME_ID);
    }
    expect(port.intents[0]).toMatchObject({ clientPoint: { x: 10, y: 20 }, pointerId: 3 });
    expect(port.intents[3]).toMatchObject({ clientPoint: { x: 12, y: 30 }, clickCount: 1 });
  });

  test('intents carry no DOM objects, so they stay serializable', () => {
    const element = new FakeElement();
    const port = fakePort();
    attachAdapterEventBridge(element, port);
    element.emit('pointerdown', pointerEvent());
    element.emit('keydown', keyEvent('ArrowDown'));

    for (const intent of port.intents) {
      expect(() => JSON.parse(JSON.stringify(intent))).not.toThrow();
      expect(JSON.parse(JSON.stringify(intent))).toEqual(intent as unknown as Record<string, unknown>);
    }
  });

  test('non-primary pointer buttons are not forwarded', () => {
    const element = new FakeElement();
    const port = fakePort();
    attachAdapterEventBridge(element, port);
    element.emit('pointerdown', pointerEvent({ button: 2, buttons: 2 }));
    element.emit('click', pointerEvent({ button: 1, buttons: 4 }));
    expect(port.intents).toHaveLength(0);
  });

  test('geometry keys dispatch and are prevented; text keys are left to the input host', () => {
    const element = new FakeElement();
    const port = fakePort();
    attachAdapterEventBridge(element, port);

    const arrow = keyEvent('ArrowDown', { shiftKey: true });
    element.emit('keydown', arrow);
    expect(port.intents).toHaveLength(1);
    expect(port.intents[0]).toMatchObject({ kind: 'geometryKeyboard', key: 'ArrowDown', shiftKey: true });
    expect(arrow.defaultPrevented).toBe(true);

    const letter = keyEvent('a');
    element.emit('keydown', letter);
    expect(port.intents).toHaveLength(1);
    expect(letter.defaultPrevented).toBe(false);
  });

  test('a rejected geometry key does not preventDefault, so the host keeps native behavior', () => {
    const element = new FakeElement();
    const port = fakePort({
      dispatchInteraction: () => ({
        outcome: { ok: false, code: 'unsupported', reason: 'no', frameId: FRAME_ID },
        hostEffects: [],
      }),
    });
    attachAdapterEventBridge(element, port);
    const arrow = keyEvent('ArrowDown');
    element.emit('keydown', arrow);
    expect(arrow.defaultPrevented).toBe(false);
  });

  test('focus and blur forward as engine intents', () => {
    const element = new FakeElement();
    const port = fakePort();
    attachAdapterEventBridge(element, port);
    element.emit('focusin', {});
    element.emit('focusout', {});
    expect(port.intents.map((i) => i.kind)).toEqual(['focus', 'blur']);
  });

  test('host effects are applied by the bridge, not by the engine', () => {
    const element = new FakeElement();
    const port = fakePort({
      dispatchInteraction: () => ({
        outcome: { ok: true, value: undefined, frameId: FRAME_ID },
        hostEffects: [
          { kind: 'capturePointer', pointerId: 9 },
          { kind: 'releasePointer', pointerId: 4 },
          { kind: 'scroll', delta: { x: 5, y: -12 } },
        ],
      }),
    });
    attachAdapterEventBridge(element, port);
    element.emit('pointerdown', pointerEvent());
    expect(element.captured).toEqual([9]);
    expect(element.released).toEqual([4]);
    expect(element.scrolled).toEqual([{ x: 5, y: -12 }]);
  });

  test('dispose removes every listener it added', () => {
    const element = new FakeElement();
    const port = fakePort();
    const dispose = attachAdapterEventBridge(element, port);
    expect(element.listenerCount()).toBeGreaterThan(0);
    dispose();
    expect(element.listenerCount()).toBe(0);
    element.emit('pointerdown', pointerEvent());
    expect(port.intents).toHaveLength(0);
  });

  test('dispose is idempotent and survives a double call', () => {
    const element = new FakeElement();
    const dispose = attachAdapterEventBridge(element, fakePort());
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(element.listenerCount()).toBe(0);
  });

  test('a bridge with no live frame dispatches nothing', () => {
    const element = new FakeElement();
    const port = fakePort({ getInteractionFrameId: () => null });
    attachAdapterEventBridge(element, port);
    element.emit('pointerdown', pointerEvent());
    element.emit('keydown', keyEvent('ArrowDown'));
    expect(port.intents).toHaveLength(0);
  });
});
