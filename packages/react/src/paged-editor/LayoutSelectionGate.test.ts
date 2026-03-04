/**
 * LayoutSelectionGate Unit Tests
 *
 * Tests sequence-based synchronization between document changes and layout rendering.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { LayoutSelectionGate } from './LayoutSelectionGate';

describe('LayoutSelectionGate', () => {
  let gate: LayoutSelectionGate;

  beforeEach(() => {
    gate = new LayoutSelectionGate();
  });

  describe('document state sequence management', () => {
    it('starts with sequence 0', () => {
      expect(gate.getStateSeq()).toBe(0);
    });

    it('setStateSeq sets the sequence value', () => {
      gate.setStateSeq(5);
      expect(gate.getStateSeq()).toBe(5);
    });

    it('incrementStateSeq increments and returns new value', () => {
      const result = gate.incrementStateSeq();
      expect(result).toBe(1);
      expect(gate.getStateSeq()).toBe(1);
    });

    it('incrementStateSeq increments multiple times', () => {
      gate.incrementStateSeq();
      gate.incrementStateSeq();
      const result = gate.incrementStateSeq();
      expect(result).toBe(3);
    });
  });

  describe('render sequence management', () => {
    it('starts with render sequence 0', () => {
      expect(gate.getRenderSeq()).toBe(0);
    });

    it('onLayoutComplete sets render sequence', () => {
      gate.onLayoutComplete(5);
      expect(gate.getRenderSeq()).toBe(5);
    });
  });

  describe('layout updating state', () => {
    it('is not updating initially', () => {
      expect(gate.isSafeToRender()).toBe(true);
    });

    it('onLayoutStart marks as updating (not safe)', () => {
      gate.onLayoutStart();
      expect(gate.isSafeToRender()).toBe(false);
    });

    it('onLayoutComplete clears updating state', () => {
      gate.onLayoutStart();
      gate.onLayoutComplete(0);
      expect(gate.isSafeToRender()).toBe(true);
    });
  });

  describe('isSafeToRender', () => {
    it('is safe when render seq >= state seq and not updating', () => {
      gate.setStateSeq(3);
      gate.onLayoutComplete(3);
      expect(gate.isSafeToRender()).toBe(true);
    });

    it('is safe when render seq > state seq', () => {
      gate.setStateSeq(2);
      gate.onLayoutComplete(5);
      expect(gate.isSafeToRender()).toBe(true);
    });

    it('is NOT safe when render seq < state seq', () => {
      gate.setStateSeq(5);
      gate.onLayoutComplete(3);
      expect(gate.isSafeToRender()).toBe(false);
    });

    it('is NOT safe when layout is updating', () => {
      gate.setStateSeq(3);
      gate.onLayoutComplete(3);
      gate.onLayoutStart();
      expect(gate.isSafeToRender()).toBe(false);
    });

    it('is NOT safe when both updating and sequence mismatch', () => {
      gate.setStateSeq(5);
      gate.onLayoutStart();
      expect(gate.isSafeToRender()).toBe(false);
    });
  });

  describe('render callbacks', () => {
    it('onRender registers a callback', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });
      gate.requestRender();
      expect(called).toBe(true);
    });

    it('onRender returns unsubscribe function', () => {
      let callCount = 0;
      const unsubscribe = gate.onRender(() => {
        callCount++;
      });

      gate.requestRender();
      expect(callCount).toBe(1);

      unsubscribe();
      gate.requestRender();
      expect(callCount).toBe(1); // Should not increment
    });

    it('multiple callbacks are called', () => {
      let count1 = 0;
      let count2 = 0;

      gate.onRender(() => {
        count1++;
      });
      gate.onRender(() => {
        count2++;
      });

      gate.requestRender();

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('callback errors do not prevent other callbacks', () => {
      let secondCalled = false;

      gate.onRender(() => {
        throw new Error('Test error');
      });
      gate.onRender(() => {
        secondCalled = true;
      });

      // Should not throw
      gate.requestRender();
      expect(secondCalled).toBe(true);
    });
  });

  describe('requestRender', () => {
    it('executes immediately when safe', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.requestRender();
      expect(called).toBe(true);
    });

    it('defers execution when not safe (updating)', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.onLayoutStart();
      gate.requestRender();
      expect(called).toBe(false);
    });

    it('defers execution when not safe (sequence mismatch)', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.setStateSeq(5);
      gate.requestRender();
      expect(called).toBe(false);
    });

    it('pending render executes when layout completes', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.setStateSeq(1);
      gate.onLayoutStart();
      gate.requestRender();
      expect(called).toBe(false);

      gate.onLayoutComplete(1);
      expect(called).toBe(true);
    });

    it('pending render requires matching sequence', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.setStateSeq(2);
      gate.onLayoutStart();
      gate.requestRender();

      // Complete with old sequence
      gate.onLayoutComplete(1);
      expect(called).toBe(false);

      // Complete with matching sequence
      gate.onLayoutComplete(2);
      expect(called).toBe(true);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      gate.setStateSeq(10);
      gate.onLayoutStart();
      gate.onLayoutComplete(5);
      gate.requestRender(); // Creates pending render

      gate.reset();

      expect(gate.getStateSeq()).toBe(0);
      expect(gate.getRenderSeq()).toBe(0);
      expect(gate.isSafeToRender()).toBe(true);
    });

    it('clears pending render', () => {
      let called = false;
      gate.onRender(() => {
        called = true;
      });

      gate.setStateSeq(5);
      gate.requestRender();
      expect(called).toBe(false);

      gate.reset();

      // After reset, should be safe but pending was cleared
      expect(gate.isSafeToRender()).toBe(true);

      // Complete layout - no pending render should execute
      gate.onLayoutComplete(0);
      expect(called).toBe(false);
    });
  });

  describe('getDebugInfo', () => {
    it('returns current state', () => {
      gate.setStateSeq(3);
      gate.onLayoutComplete(2);

      const info = gate.getDebugInfo();

      expect(info.stateSeq).toBe(3);
      expect(info.renderSeq).toBe(2);
      expect(info.layoutUpdating).toBe(false);
      expect(info.hasPendingRender).toBe(false);
      expect(info.isSafe).toBe(false);
    });

    it('shows updating state', () => {
      gate.onLayoutStart();
      const info = gate.getDebugInfo();
      expect(info.layoutUpdating).toBe(true);
    });

    it('shows pending render', () => {
      gate.onRender(() => {});
      gate.setStateSeq(5);
      gate.requestRender();

      const info = gate.getDebugInfo();
      expect(info.hasPendingRender).toBe(true);
    });

    it('shows safe state', () => {
      gate.setStateSeq(3);
      gate.onLayoutComplete(3);

      const info = gate.getDebugInfo();
      expect(info.isSafe).toBe(true);
    });
  });

  describe('typical workflow', () => {
    it('handles document change -> layout -> render cycle', () => {
      let renderCount = 0;
      gate.onRender(() => {
        renderCount++;
      });

      // 1. Document changes
      const seq = gate.incrementStateSeq();
      expect(seq).toBe(1);

      // 2. Request render (should defer - layout stale)
      gate.requestRender();
      expect(renderCount).toBe(0);

      // 3. Layout starts
      gate.onLayoutStart();
      expect(gate.isSafeToRender()).toBe(false);

      // 4. Another change while layout in progress
      gate.incrementStateSeq();

      // 5. Layout completes with old sequence
      gate.onLayoutComplete(1);
      expect(renderCount).toBe(0); // Still not safe, seq 2 > 1

      // 6. Layout starts again
      gate.onLayoutStart();

      // 7. Layout completes with current sequence
      gate.onLayoutComplete(2);
      expect(renderCount).toBe(1); // Now safe!
    });

    it('handles rapid changes gracefully', () => {
      let renderCount = 0;
      gate.onRender(() => {
        renderCount++;
      });

      // Rapid document changes
      for (let i = 0; i < 10; i++) {
        gate.incrementStateSeq();
        gate.requestRender();
      }

      // Only one render should be pending
      expect(renderCount).toBe(0);

      // Layout catches up
      gate.onLayoutComplete(10);
      expect(renderCount).toBe(1);
    });
  });
});
