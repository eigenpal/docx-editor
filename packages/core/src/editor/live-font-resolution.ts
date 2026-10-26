import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import { supportedFontFamilies } from '../layout/supported-font-families.ts';
import { drawingPartFontFamilies } from '../store/package/drawing-part-fonts.ts';
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
        // Chart and diagram labels name faces outside every story.
        ...drawingPartFontFamilies(session.currentPackage(), session.documentThemeFonts()),
      ]),
    ],
    resolverGlyphFontFamilies(session),
    MAX_RESOLVER_FAMILIES
  );
}

/** Serialize font updates within a document. A new document can supersede a pending fetch. */
export function createLiveFontResolution<Late>(
  read: () => { generation: number; families: () => readonly string[]; dynamic: boolean } | null,
  resolve: (families: readonly string[], late?: Late) => Promise<void>
): {
  /** Queue a resolution; `initial` runs it now and returns its work, if it started any. */
  schedule(initial?: boolean): Promise<void> | undefined;
  /**
   * Queue faces that arrived after the first paint, for the font generation that asked for
   * them. They install after any resolution in flight, so the two never race.
   */
  deliver(generation: number, late: Late): void;
} {
  let current:
    | { generation: number; requested: Set<string>; running: boolean; late: Late[] }
    | undefined;
  let queued = false;
  const pump = (): Promise<void> | undefined => {
    queued = false;
    const state = read();
    if (!state) return;
    const initial = current?.generation !== state.generation;
    if (initial) {
      current = { generation: state.generation, requested: new Set(), running: false, late: [] };
    }
    const active = current!;
    if (active.running) return;
    const late = active.late.shift();
    if (late !== undefined) {
      active.running = true;
      const work = resolve(state.families(), late);
      void work.finally(() => {
        active.running = false;
        if (current === active) schedule();
      });
      return work;
    }
    if (!initial && !state.dynamic) return;
    // A fixed configuration asks nothing of a resolver, but the document's substitution plan
    // still needs its families: without them no family the configuration lacks falls back.
    const families = state
      .families()
      .filter((family) => !active.requested.has(family.toLowerCase()));
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
  const deliver = (generation: number, late: Late): void => {
    if (current?.generation !== generation) return;
    current.late.push(late);
    schedule();
  };
  return { schedule, deliver };
}
