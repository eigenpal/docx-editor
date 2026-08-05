import type { CanonicalRevisionRef } from './revision-bridge.ts';

export interface RecordedResolution {
  readonly ref: CanonicalRevisionRef;
  readonly mode: 'accept' | 'reject';
}

const RESOLUTIONS = new WeakMap<object, RecordedResolution[]>();

function resolutionIdentity(resolution: RecordedResolution): string {
  const ref = resolution.ref;
  return `${resolution.mode}:${ref.story.kind === 'body' ? 'body' : `${ref.story.kind}:${ref.story.noteId}`}:${ref.type}:${ref.address.id}:${ref.address.author}:${ref.address.date ?? ''}`;
}

export function recordResolution(
  doc: object,
  ref: CanonicalRevisionRef,
  mode: 'accept' | 'reject'
): void {
  const existing = RESOLUTIONS.get(doc) ?? [];
  existing.push({ ref, mode });
  RESOLUTIONS.set(doc, existing);
}

/** Read pending resolutions without removing them. */
export function peekResolutions(doc: object): readonly RecordedResolution[] {
  const existing = RESOLUTIONS.get(doc);
  return existing ? [...existing] : [];
}

/** Remove only resolutions that were successfully applied. */
export function acknowledgeResolutions(doc: object, consumed: readonly RecordedResolution[]): void {
  if (consumed.length === 0) return;
  const existing = RESOLUTIONS.get(doc);
  if (!existing || existing.length === 0) return;
  const consumedKeys = new Set(consumed.map(resolutionIdentity));
  const remaining = existing.filter(
    (resolution) => !consumedKeys.has(resolutionIdentity(resolution))
  );
  if (remaining.length === 0) RESOLUTIONS.delete(doc);
  else RESOLUTIONS.set(doc, remaining);
}

/** @deprecated Prefer {@link peekResolutions} + {@link acknowledgeResolutions}. */
export function drainResolutions(doc: object): readonly RecordedResolution[] {
  const pending = peekResolutions(doc);
  acknowledgeResolutions(doc, pending);
  return pending;
}

export function cloneResolutionLog(source: object, target: object): void {
  const existing = RESOLUTIONS.get(source);
  if (existing) RESOLUTIONS.set(target, [...existing]);
}
