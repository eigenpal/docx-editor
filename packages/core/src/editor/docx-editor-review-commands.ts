import type {
  EditorModuleRegistry,
  ReviewDisplayMode,
  ReviewModelInput,
  ReviewModuleContribution,
} from '../contracts/modules.ts';

import { partOfNodeId } from './surface-scope.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { planRevisionBatch, type RevisionBatchResult } from '../store/store/revision-batch.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { revisionSiteNodeIdsOf, reviewItemKey } from '../store/store/review-items.ts';
import type {
  CanResult,
  EditorCommand,
  ExecResult,
  ReviewItem,
  ReviewItemPlacement,
  ReviewRevisionItem,
  ReviewRevisionPlacement,
} from '../contracts/editor.ts';
import type { StoryScope, TreeDocOp } from '../store/index.ts';
import {
  deepParagraphOrderOfPart,
  collectRevisionSites,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '../store/index.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { PRO_REVIEW_REASON } from './opening-editing-mode.ts';

interface ReviewCommandDependencies {
  surface(): PaginatedSurface | null;
  enabled(): boolean;
  destroyed(): boolean;
  viewing(): boolean;
  placements(): readonly ReviewItemPlacement[];
  visible(): readonly ReviewItem[];
  scope(item: ReviewItem): StoryScope;
  activate(key: string | null, allowExcludedFormat?: boolean): ExecResult;
  setDisplayMode(mode: ReviewDisplayMode): void;
}

/**
 * The surface's review model, when a module registered one.
 *
 * The module's derivation reaches the session through the surface: the session owns the
 * per-revision memo, the module owns the algorithm. Registered custom-node definitions ride
 * along OPAQUELY so the derivation can contribute `custom` cards; core never looks inside.
 */
export function reviewModelOption(
  modules: EditorModuleRegistry,
  reportDiagnostic: (diagnostic: unknown) => void
): { readonly reviewModel: ReviewModuleContribution } | Record<never, never> {
  const review = modules.review;
  if (!review) return {};
  return {
    reviewModel: {
      ...review,
      collectReviewItems: (input: ReviewModelInput) =>
        review.collectReviewItems(
          modules.customNodes.length > 0
            ? {
                ...input,
                customNodes: modules.customNodes,
                ...(modules.customNodeDiagnostics.length > 0
                  ? { reportCustomNodeDiagnostic: reportDiagnostic }
                  : {}),
              }
            : input
        ),
    },
  };
}

/** Every view the command accepts, Simple Markup included. */
const REVIEW_DISPLAY_MODES: readonly ReviewDisplayMode[] = [
  'all-markup',
  'simple-markup',
  'proposed',
  'original',
];

/** Review commands share navigation, mutation gates, and atomic story resolution. */
export function createReviewCommands(deps: ReviewCommandDependencies) {
  const navigable = () =>
    deps
      .placements()
      .filter(
        (item): item is ReviewRevisionPlacement =>
          item.kind === 'revision' && (item.activatable || item.revisionKind === 'format')
      );
  const all = () =>
    deps
      .surface()
      ?.session.reviewItems()
      .filter((item): item is ReviewRevisionItem => item.kind === 'revision') ?? [];
  const bulkPlan = (command: Extract<EditorCommand, { type: 'resolveAllReviewChanges' }>) => {
    const styles = stylesPartOf(deps.surface()!.session.currentPackage());
    const items = all();
    const selected = new Set(
      command.keys ??
        (command.scope === 'document' ? items : deps.visible())
          .filter((item) => item.kind === 'revision')
          .map(reviewItemKey)
    );
    const scopes = new Map<string, { scope: StoryScope; part: OoxmlPart; keys: string[] }>();
    for (const item of items) {
      const scope = deps.scope(item);
      const part = partOfNodeId(deps.surface()!.session, revisionSiteNodeIdsOf(item)[0]);
      if (!part) continue;
      let group = scopes.get(part.name);
      if (!group) {
        group = { scope, part, keys: [] };
        scopes.set(part.name, group);
      }
      const key = reviewItemKey(item);
      if (selected.delete(key)) group.keys.push(key);
    }
    const resolved: RevisionBatchResult['resolved'][number][] = [];
    const skipped: RevisionBatchResult['skipped'][number][] = [...selected].map((key) => ({
      key,
      reason: 'unknown-revision',
    }));
    const groups: { scope: StoryScope; ops: readonly TreeDocOp[] }[] = [];
    const partOps: { partName: string; ops: readonly TreeDocOp[] }[] = [];
    let remaining = 0;
    for (const { scope, part, keys } of scopes.values()) {
      const plan = planRevisionBatch(part, command.action, keys);
      resolved.push(...plan.result.resolved);
      skipped.push(...plan.result.skipped);
      remaining += plan.result.remaining;
      if (plan.ops.length) {
        if (part.name === styles?.name) partOps.push({ partName: part.name, ops: plan.ops });
        else groups.push({ scope, ops: plan.ops });
      }
    }
    return { groups, partOps, result: { resolved, skipped, remaining } };
  };
  const ready = (): CanResult => {
    if (deps.destroyed())
      return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
    if (!deps.enabled()) return { ok: false, code: 'unsupported', reason: PRO_REVIEW_REASON };
    if (!deps.surface()) return { ok: false, code: 'notFound', reason: 'no document is open' };
    return { ok: true };
  };
  const can = (command: EditorCommand): CanResult | null => {
    if (
      command.type !== 'navigateReviewChange' &&
      command.type !== 'resolveAllReviewChanges' &&
      command.type !== 'setReviewDisplayMode'
    )
      return null;
    const gate = ready();
    if (!gate.ok) return gate;
    if (command.type === 'setReviewDisplayMode')
      return REVIEW_DISPLAY_MODES.includes(command.mode)
        ? { ok: true }
        : { ok: false, code: 'invalidArgs', reason: 'unknown review display mode' };
    if (
      command.type === 'navigateReviewChange' &&
      !['next', 'previous'].includes(command.direction)
    )
      return { ok: false, code: 'invalidArgs', reason: 'unknown review navigation direction' };
    if (
      command.type === 'resolveAllReviewChanges' &&
      !['accept', 'reject'].includes(command.action)
    )
      return { ok: false, code: 'invalidArgs', reason: 'unknown review resolution action' };
    if (command.type === 'navigateReviewChange')
      return navigable().length
        ? { ok: true }
        : { ok: false, code: 'notFound', reason: 'no visible changes to review' };
    if (deps.viewing())
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    const protectedWrite = commandProtectionRefusal(command, deps.surface()!);
    if (protectedWrite) return protectedWrite;
    if (
      (command.scope !== undefined && !['visible', 'document'].includes(command.scope)) ||
      (command.unsupported !== undefined && !['skip', 'fail'].includes(command.unsupported)) ||
      (command.keys !== undefined &&
        (!Array.isArray(command.keys) || command.keys.some((key) => typeof key !== 'string')))
    )
      return { ok: false, code: 'invalidArgs', reason: 'invalid bulk revision selection' };
    const { result } = bulkPlan(command);
    if (command.unsupported === 'fail' && result.skipped.length)
      return { ok: false, code: 'unsupported', reason: 'some selected changes cannot be resolved' };
    if (!result.resolved.length)
      return {
        ok: false,
        code: result.skipped.length ? 'unsupported' : 'notFound',
        reason: 'no eligible selected changes to review',
      };
    return { ok: true };
  };
  const resolveReviewItem = (key: string, action: 'accept' | 'reject'): ExecResult => {
    const gate = ready();
    if (!gate.ok) return gate;
    if (deps.viewing()) {
      deps
        .surface()!
        .commitReviewOps(
          () => ({ committed: false, reason: 'the document is open for viewing' }),
          'revision-resolve'
        );
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    }
    const protectedWrite = commandProtectionRefusal(
      { type: 'resolveAllReviewChanges', action },
      deps.surface()!
    );
    if (protectedWrite) return protectedWrite;
    deps.surface()!.flushPendingInput();
    const item = deps.placements().find((entry) => entry.key === key)?.item;
    if (!item || item.kind !== 'revision')
      return { ok: false, code: 'notFound', reason: 'no revision with that key' };
    if (item.readOnly)
      return {
        ok: false,
        code: 'unsupported',
        reason: 'this revision kind has no structural accept/reject yet',
      };
    let applied: { committed: boolean; reason?: unknown } | undefined;
    deps.surface()!.commitReviewOps(() => {
      const session = deps.surface()!.session;
      const part = partOfNodeId(session, revisionSiteNodeIdsOf(item)[0]);
      if (part && part.name === stylesPartOf(session.currentPackage())?.name) {
        applied = session.applyTreeOpsAtomic([], {
          partOps: [{ partName: part.name, ops: resolutionOps(item, action, part) }],
        });
        return applied;
      }
      applied = deps
        .surface()!
        .session.applyTreeOps(
          resolutionOps(item, action, deps.surface()!.session.partFor(deps.scope(item))),
          undefined,
          undefined,
          deps.scope(item)
        );
      return applied;
    }, 'revision-resolve');
    if (!applied?.committed)
      return {
        ok: false,
        code: 'unsupported',
        reason: typeof applied?.reason === 'string' ? applied.reason : 'the revision was refused',
      };
    return { ok: true, changed: true };
  };
  const exec = (command: EditorCommand): ExecResult | null => {
    if (
      !['navigateReviewChange', 'resolveAllReviewChanges', 'setReviewDisplayMode'].includes(
        command.type
      )
    )
      return null;
    deps.surface()?.flushPendingInput();
    const gate = can(command);
    if (!gate) return null;
    if (!gate.ok) {
      if (
        command.type === 'resolveAllReviewChanges' &&
        (gate.code === 'notFound' || gate.code === 'unsupported') &&
        ready().ok &&
        !deps.viewing()
      ) {
        const { result } = bulkPlan(command);
        return {
          ...gate,
          revisions: {
            ...result,
            resolved: [],
            remaining: result.remaining + result.resolved.length,
          },
        };
      }
      return gate;
    }
    const surface = deps.surface()!;
    if (command.type === 'setReviewDisplayMode') {
      deps.setDisplayMode(command.mode);
      return { ok: true, changed: false };
    }
    if (command.type === 'navigateReviewChange') {
      const items = navigable();
      const active = items.findIndex((item) => item.isActive);
      const step = command.direction === 'next' ? 1 : -1;
      const index =
        active < 0
          ? nextFromCaret(items, surface, step)
          : (active + step + items.length) % items.length;
      const target = items[index]!;
      return deps.activate(target.key, !target.activatable && target.revisionKind === 'format');
    }
    if (command.type !== 'resolveAllReviewChanges') return null;
    const { groups, partOps, result } = bulkPlan(command);
    let applied: { committed: boolean; reason?: unknown } | undefined;
    surface.commitReviewOps(() => {
      applied = surface.session.applyTreeOpsAtomic(groups, { partOps });
      return applied;
    }, 'revision-resolve');
    if (!applied?.committed)
      return {
        ok: false,
        code: 'unsupported',
        reason: typeof applied?.reason === 'string' ? applied.reason : 'the revisions were refused',
      };
    deps.activate(null);
    return { ok: true, changed: true, revisions: { ...result, remaining: all().length } };
  };
  return { can, exec, resolveReviewItem };
}

function nextFromCaret(
  items: readonly ReviewItemPlacement[],
  surface: PaginatedSurface,
  step: number
): number {
  const caret = surface.state().selection.head;
  const part = surface.session
    .storyParts()
    .find((candidate) => caret.paragraphId.startsWith(`${candidate.name}#`));
  const order = part ? deepParagraphOrderOfPart(part) : new Map<string, number>();
  const rank = order.get(caret.paragraphId);
  if (rank !== undefined) {
    for (
      let index = step > 0 ? 0 : items.length - 1;
      index >= 0 && index < items.length;
      index += step
    ) {
      const item = items[index]!;
      const start = item.kind === 'revision' ? item.item.ranges[0]?.start : undefined;
      const at = start ? order.get(start.paragraphId) : undefined;
      if (
        start &&
        at !== undefined &&
        (step > 0
          ? at > rank || (at === rank && start.offset >= caret.offset)
          : at < rank || (at === rank && start.offset <= caret.offset))
      )
        return index;
    }
  }
  return step > 0 ? 0 : items.length - 1;
}

/** Resolve only the canonical sites that contributed to this card. */
function resolutionOps(
  item: ReviewRevisionItem,
  action: 'accept' | 'reject',
  part: OoxmlPart | null
): TreeDocOp[] {
  const op = action === 'accept' ? 'acceptRevision' : 'rejectRevision';
  if (!part) return [];
  const nodeIds = new Set(revisionSiteNodeIdsOf(item));
  const operations = new Map<
    string,
    {
      revision: ReviewRevisionItem['address'];
      localName: string | undefined;
      siteNodeIds: string[];
    }
  >();
  for (const site of collectRevisionSites(part)) {
    if (!nodeIds.has(site.node.id)) continue;
    const attr = (name: string) =>
      site.node.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value;
    const revision = item.addresses.find(
      (address) =>
        address.id === attr('id') &&
        address.author === (attr('author') ?? '') &&
        (address.date ?? '') === (attr('date') ?? '')
    );
    if (!revision) continue;
    // A tracked row is one decision across its `del` and `cellDel` markers.
    const localName = item.revisionKind === 'structural' ? undefined : site.node.localName;
    const key = JSON.stringify([revision, localName]);
    const known = operations.get(key);
    if (known) known.siteNodeIds.push(site.node.id);
    else operations.set(key, { revision, localName, siteNodeIds: [site.node.id] });
  }
  return [...operations.values()].map(({ revision, localName, siteNodeIds }) => ({
    op,
    revision,
    ...(localName === undefined ? {} : { localName }),
    siteNodeIds,
  }));
}

/** Date metadata shared by comment and revision placements. */
export function dateOfReviewItem(item: ReviewItem): string | undefined {
  if (item.kind === 'comment') return item.comment.date;
  return item.kind === 'revision' ? item.date : undefined;
}
