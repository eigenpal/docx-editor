import { inject, shallowRef, watch, type InjectionKey, type ShallowRef } from 'vue';
import { scopeDispose } from '../scope-dispose';

/** @internal */
export interface NavigationLayoutStore {
  getShift(): number;
  setShift(px: number): void;
  subscribeShift(listener: () => void): () => void;
  getReservation(): number;
  setReservation(px: number): void;
  subscribeReservation(listener: () => void): () => void;
  getViewport(): HTMLElement | null;
  setViewport(element: HTMLElement | null): void;
  subscribeViewport(listener: () => void): () => void;
}

/** @internal */
export function createNavigationLayoutStore(): NavigationLayoutStore {
  let shift = 0;
  let reservation = 0;
  let viewport: HTMLElement | null = null;
  const shiftListeners = new Set<() => void>();
  const reservationListeners = new Set<() => void>();
  const viewportListeners = new Set<() => void>();
  const notify = (listeners: Set<() => void>) => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getShift: () => shift,
    setShift(px) {
      const next = Math.max(0, Math.round(px));
      if (next === shift) return;
      shift = next;
      notify(shiftListeners);
    },
    subscribeShift(listener) {
      shiftListeners.add(listener);
      return () => shiftListeners.delete(listener);
    },
    getReservation: () => reservation,
    setReservation(px) {
      const next = Math.max(0, Math.round(px));
      if (next === reservation) return;
      reservation = next;
      notify(reservationListeners);
    },
    subscribeReservation(listener) {
      reservationListeners.add(listener);
      return () => reservationListeners.delete(listener);
    },
    getViewport: () => viewport,
    setViewport(element) {
      if (element === viewport) return;
      viewport = element;
      notify(viewportListeners);
    },
    subscribeViewport(listener) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
  };
}

/** @internal */
export const navigationLayoutKey: InjectionKey<NavigationLayoutStore> = Symbol('navigationLayout');

/** @internal */
export function useNavigationLayoutStore(): NavigationLayoutStore | null {
  return inject(navigationLayoutKey, null);
}

/** @public */
export function useNavigationShift(): ShallowRef<number> {
  const store = useNavigationLayoutStore();
  const out = shallowRef(0);

  const stop = watch(
    () => store,
    (nextStore, _prev, onCleanup) => {
      if (!nextStore) {
        out.value = 0;
        return;
      }
      const bump = () => {
        out.value = nextStore.getShift();
      };
      bump();
      const off = nextStore.subscribeShift(bump);
      onCleanup(off);
    },
    { immediate: true, flush: 'post' }
  );

  scopeDispose(stop);
  return out;
}

/** @internal */
export function useNavigationReservation(): ShallowRef<number> {
  const store = useNavigationLayoutStore();
  const out = shallowRef(0);

  const stop = watch(
    () => store,
    (nextStore, _prev, onCleanup) => {
      if (!nextStore) {
        out.value = 0;
        return;
      }
      const bump = () => {
        out.value = nextStore.getReservation();
      };
      bump();
      const off = nextStore.subscribeReservation(bump);
      onCleanup(off);
    },
    { immediate: true, flush: 'post' }
  );

  scopeDispose(stop);
  return out;
}

/** @internal */
export function useNavigationViewportElement(): ShallowRef<HTMLElement | null> {
  const store = useNavigationLayoutStore();
  const out = shallowRef<HTMLElement | null>(null);

  const stop = watch(
    () => store,
    (nextStore, _prev, onCleanup) => {
      if (!nextStore) {
        out.value = null;
        return;
      }
      const bump = () => {
        out.value = nextStore.getViewport();
      };
      bump();
      const off = nextStore.subscribeViewport(bump);
      onCleanup(off);
    },
    { immediate: true, flush: 'post' }
  );

  scopeDispose(stop);
  return out;
}
