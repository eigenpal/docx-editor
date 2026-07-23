// Command/query scopes (document-engine task 7.6 / design D8). A write targets an
// explicit body / specific-story scope, or — when the scope is omitted — the
// ACTIVE story, which may be a header or footer. It MUST NOT silently fall back to
// the body. A read-only aggregate scope spans all stories and cannot be written.

import { bodyStoryId, type PackageModel } from '../model/index.ts';

export type Scope =
  | { readonly kind: 'body' }
  | { readonly kind: 'story'; readonly storyId: string }
  | { readonly kind: 'active' }
  | { readonly kind: 'aggregate' };

export type ScopeResolution =
  | { readonly ok: true; readonly storyId: string }
  | { readonly ok: false; readonly reason: 'aggregate-not-writable' | 'unknown-story' | 'no-active-story' };

export interface ScopeContext {
  /** The currently active story (e.g. an editing cursor in a header). */
  readonly activeStoryId?: string;
}

/**
 * Resolve a WRITE scope to a target story id. An omitted scope (`active`) uses the
 * active story — if that is a header/footer, the write goes there, never the body.
 * Aggregate is read-only and cannot resolve to a write target.
 */
export function resolveWriteScope(model: PackageModel, scope: Scope | undefined, ctx: ScopeContext = {}): ScopeResolution {
  const s: Scope = scope ?? { kind: 'active' };
  switch (s.kind) {
    case 'body':
      return { ok: true, storyId: bodyStoryId(model) };
    case 'story':
      return model.stories.has(s.storyId) ? { ok: true, storyId: s.storyId } : { ok: false, reason: 'unknown-story' };
    case 'active': {
      if (ctx.activeStoryId === undefined) return { ok: false, reason: 'no-active-story' };
      return model.stories.has(ctx.activeStoryId)
        ? { ok: true, storyId: ctx.activeStoryId }
        : { ok: false, reason: 'unknown-story' };
    }
    case 'aggregate':
      return { ok: false, reason: 'aggregate-not-writable' };
  }
}

/** The story ids a READ scope spans (aggregate = all stories). */
export function resolveReadScope(model: PackageModel, scope: Scope | undefined, ctx: ScopeContext = {}): string[] {
  const s: Scope = scope ?? { kind: 'active' };
  if (s.kind === 'aggregate') return [...model.stories.keys()];
  const w = resolveWriteScope(model, s, ctx);
  return w.ok ? [w.storyId] : [];
}
