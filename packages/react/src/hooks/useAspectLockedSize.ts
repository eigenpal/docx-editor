import { useCallback, useRef, useState } from 'react';

/**
 * Width/height inputs with an optional aspect-ratio lock. `width`/`height`
 * are `number | ''` so a cleared field shows empty instead of 0.
 */
export interface UseAspectLockedSizeReturn {
  width: number | '';
  height: number | '';
  lockAspect: boolean;
  setLockAspect: (locked: boolean) => void;
  /** Number-input onChange handlers. Empty string clears, otherwise clamps to >= 1. */
  handleWidthChange: (raw: string) => void;
  handleHeightChange: (raw: string) => void;
  /** Seed both fields and re-lock. Null/undefined values clear the input. */
  seed: (w: number | null | undefined, h: number | null | undefined) => void;
}

export function useAspectLockedSize(): UseAspectLockedSizeReturn {
  const [width, setWidth] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [lockAspect, setLockAspect] = useState(true);
  const ratioRef = useRef<number | null>(null);

  const seed = useCallback((w: number | null | undefined, h: number | null | undefined) => {
    setWidth(w ?? '');
    setHeight(h ?? '');
    ratioRef.current = w && h ? w / h : null;
    setLockAspect(true);
  }, []);

  const handleWidthChange = useCallback(
    (raw: string) => {
      const v = raw === '' ? '' : Math.max(1, Number(raw) || 0);
      setWidth(v);
      const ratio = ratioRef.current;
      if (lockAspect && ratio && typeof v === 'number') {
        setHeight(Math.round(v / ratio));
      }
    },
    [lockAspect]
  );

  const handleHeightChange = useCallback(
    (raw: string) => {
      const v = raw === '' ? '' : Math.max(1, Number(raw) || 0);
      setHeight(v);
      const ratio = ratioRef.current;
      if (lockAspect && ratio && typeof v === 'number') {
        setWidth(Math.round(v * ratio));
      }
    },
    [lockAspect]
  );

  return {
    width,
    height,
    lockAspect,
    setLockAspect,
    handleWidthChange,
    handleHeightChange,
    seed,
  };
}
