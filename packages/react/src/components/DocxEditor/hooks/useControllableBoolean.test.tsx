import { GlobalRegistrator } from '@happy-dom/global-registrator';

// ONE guarded registration for the whole process, which is what every other DOM test file
// in this repo does. bun runs all test files in a single process, so `register()` is a
// process-global: an unguarded `beforeAll(register)` threw "Happy DOM has already been
// globally registered" whenever any of the seventeen engine-editor test files had loaded
// first, and the matching `afterAll(unregister)` tore the DOM out from under every file
// that had already registered and still needed it. Both were recorded as baseline
// failures. Registering once, idempotently, and never unregistering is the pattern that
// actually holds across a shared process.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useControllableBoolean } from './useControllableBoolean';

afterEach(() => {
  cleanup();
});

describe('useControllableBoolean', () => {
  test('uncontrolled: owns state, updates value, and emits through onChange', () => {
    const onChange = mock((_v: boolean) => {});
    const { result } = renderHook(() => useControllableBoolean(undefined, onChange));

    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    // Functional updates read the latest value.
    act(() => result.current[1]((v) => !v));
    expect(result.current[0]).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test('uncontrolled: respects a non-default initial value', () => {
    const { result } = renderHook(() => useControllableBoolean(undefined, undefined, true));
    expect(result.current[0]).toBe(true);
  });

  test('controlled: prop is the source of truth and internal state is bypassed', () => {
    const onChange = mock((_v: boolean) => {});
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useControllableBoolean(open, onChange),
      { initialProps: { open: false } }
    );

    expect(result.current[0]).toBe(false);

    // Setter emits the requested value but does NOT change the rendered value;
    // the consumer drives it via the prop.
    act(() => result.current[1](true));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(result.current[0]).toBe(false);

    // Consumer honors the change by updating the prop.
    rerender({ open: true });
    expect(result.current[0]).toBe(true);

    // Functional updates compute from the controlled value, not stale state.
    act(() => result.current[1]((v) => !v));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test('does not emit onChange when the value would not change', () => {
    const onChange = mock((_v: boolean) => {});
    const { result } = renderHook(() => useControllableBoolean(undefined, onChange));

    act(() => result.current[1](false));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('setter identity is stable across renders', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean | undefined }) => useControllableBoolean(open),
      { initialProps: { open: undefined as boolean | undefined } }
    );
    const first = result.current[1];
    rerender({ open: true });
    expect(result.current[1]).toBe(first);
  });
});
