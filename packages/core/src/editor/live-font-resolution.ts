import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import { supportedFontFamilies } from '../layout/supported-font-families.ts';
import { fontResolverFamilies } from './font-availability.ts';
import { MAX_RESOLVER_FAMILIES } from './font-composition.ts';
import { resolverGlyphFontFamilies } from './resolver-glyph-font-families.ts';

/**
 * The families to ask a font resolver for: the caret's family when it is not the default,
 * then every family the document uses.
 */
export function liveFontFamilies(
  session: TreeDocxSessionView,
  caretFamily: string | undefined,
  defaultFamily: string | undefined
): readonly string[] {
  const [selected] = supportedFontFamilies([[caretFamily]]);
  return fontResolverFamilies(
    [
      ...new Set([
        ...(selected && selected !== defaultFamily ? [selected] : []),
        ...session.documentFonts(),
      ]),
    ],
    resolverGlyphFontFamilies(session),
    MAX_RESOLVER_FAMILIES
  );
}

/** Serialize font updates within a document. A new document can supersede a pending fetch. */
export function createLiveFontResolution(
  read: () => { generation: number; families: () => readonly string[]; dynamic: boolean } | null,
  resolve: (families: readonly string[]) => Promise<void>
): {
  /** Queue a resolution; `initial` runs it now and returns its work, if it started any. */
  schedule(initial?: boolean): Promise<void> | undefined;
} {
  let current: { generation: number; requested: Set<string>; running: boolean } | undefined;
  let queued = false;
  const pump = (): Promise<void> | undefined => {
    queued = false;
    const state = read();
    if (!state) return;
    const initial = current?.generation !== state.generation;
    if (initial) current = { generation: state.generation, requested: new Set(), running: false };
    const active = current!;
    if (active.running || (!initial && !state.dynamic)) return;
    const families = state.dynamic
      ? state.families().filter((family) => !active.requested.has(family.toLowerCase()))
      : [];
    if (!initial && families.length === 0) return;
    for (const family of families) active.requested.add(family.toLowerCase());
    active.running = true;
    // Failed families stay attempted until the next document load. A failing provider
    // must not retry on every keystroke. resolve owns error reporting and degradation.
    const work = resolve(families);
    void work.finally(() => {
      active.running = false;
      if (current === active) schedule();
    });
    return work;
  };
  const schedule = (initial = false): Promise<void> | undefined => {
    if (initial) return pump();
    if (queued) return;
    queued = true;
    queueMicrotask(pump);
  };
  return { schedule };
}
