export function applyLockedDimensionChange(args: {
  width: number;
  height: number;
  ratio: number;
  lock: boolean;
  changed: 'width' | 'height';
  value: number;
}): { width: number; height: number } {
  const { width, height, ratio, lock, changed, value } = args;

  if (!lock || !ratio || ratio <= 0) {
    return changed === 'width' ? { width: value, height } : { width, height: value };
  }

  if (changed === 'width') {
    return { width: value, height: Math.round(value / ratio) };
  }

  return { width: Math.round(value * ratio), height: value };
}
