import { revisionSiteNodeIdsOf } from '../store/store/review-items.ts';
import type {
  CanResult,
  EditorCommand,
  ExecResult,
  ReviewItem,
  ReviewItemPlacement,
  ReviewRevisionItem,
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
  scope(item: ReviewItem): StoryScope;
  activate(key: string | null): ExecResult;
  setDisplayMode(mode: 'all-markup' | 'proposed' | 'original'): void;
}

/** Review commands share navigation, mutation gates, and atomic story resolution. */
export function createReviewCommands(deps: ReviewCommandDependencies) {
  const visible = () =>
    deps.placements().filter((item) => item.kind === 'revision' && item.activatable);
  const all = () =>
    deps
      .surface()
      ?.session.reviewItems()
      .filter((item): item is ReviewRevisionItem => item.kind === 'revision') ?? [];
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
      return ['all-markup', 'proposed', 'original'].includes(command.mode)
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
      return visible().length
        ? { ok: true }
        : { ok: false, code: 'notFound', reason: 'no visible changes to review' };
    if (deps.viewing())
      return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
    const items = all();
    if (!items.length) return { ok: false, code: 'notFound', reason: 'no changes to review' };
    if (items.some((item) => item.readOnly))
      return {
        ok: false,
        code: 'unsupported',
        reason: 'some changes cannot be accepted or rejected by this editor',
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
    if (!gate.ok) return gate;
    const surface = deps.surface()!;
    if (command.type === 'setReviewDisplayMode') {
      deps.setDisplayMode(command.mode);
      return { ok: true, changed: false };
    }
    if (command.type === 'navigateReviewChange') {
      const items = visible();
      const active = items.findIndex((item) => item.isActive);
      const step = command.direction === 'next' ? 1 : -1;
      const index =
        active < 0
          ? nextFromCaret(items, surface, step)
          : (active + step + items.length) % items.length;
      return deps.activate(items[index]!.key);
    }
    if (command.type !== 'resolveAllReviewChanges') return null;
    const scopes = new Map<string, StoryScope>();
    for (const item of all()) {
      const scope = deps.scope(item);
      scopes.set(JSON.stringify(scope), scope);
    }
    let applied: { committed: boolean; reason?: unknown } | undefined;
    surface.commitReviewOps(() => {
      applied = surface.session.applyTreeOpsAtomic(
        [...scopes.values()].map((scope) => ({
          scope,
          ops: [{ op: command.action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' }],
        }))
      );
      return applied;
    }, 'revision-resolve');
    if (!applied?.committed)
      return {
        ok: false,
        code: 'unsupported',
        reason: typeof applied?.reason === 'string' ? applied.reason : 'the revisions were refused',
      };
    deps.activate(null);
    return { ok: true, changed: true };
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

function revisionElementName(item: ReviewRevisionItem): string | undefined {
  if (item.revisionKind === 'format') return item.formattingKind;
  const kind = item.revisionKind === 'paragraphMark' ? item.markDirection : item.revisionKind;
  return kind === 'insert'
    ? 'ins'
    : kind === 'delete'
      ? 'del'
      : kind === 'moveFrom' || kind === 'moveTo'
        ? kind
        : undefined;
}

/** A replacement must not resolve unrelated formatting that reused a content revision ID. */
function resolutionOps(
  item: ReviewRevisionItem,
  action: 'accept' | 'reject',
  part: OoxmlPart | null
): TreeDocOp[] {
  const op = action === 'accept' ? 'acceptRevision' : 'rejectRevision';
  if (item.revisionKind !== 'replace') {
    const localName = revisionElementName(item);
    return item.addresses.map((revision) => ({
      op,
      revision,
      ...(localName ? { localName } : {}),
    }));
  }
  if (!part) return [];
  const nodeIds = new Set(revisionSiteNodeIdsOf(item));
  const operations = new Map<string, TreeDocOp>();
  for (const site of collectRevisionSites(part)) {
    if (!nodeIds.has(site.node.id)) continue;
    const attr = (name: string) =>
      site.node.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value;
    const revision = item.addresses.find(
      (address) =>
        address.id === attr('id') &&
        address.author === attr('author') &&
        (address.date ?? '') === (attr('date') ?? '')
    );
    if (!revision) continue;
    const localName = site.node.localName;
    operations.set(JSON.stringify([revision, localName]), { op, revision, localName });
  }
  return [...operations.values()];
}
