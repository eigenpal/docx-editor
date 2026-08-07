// The headless automation host.
//
// It owns what a browser session owns and nothing more: a package it opened through the
// bounded OPC/XML reader, one `TreePackageStore` over it, and the same `transact` write path
// the editor uses. There is no second model here — the store IS the document, exactly as in
// the browser, which is why the differential tests can compare the two hosts' canonical
// fingerprints rather than just their answers.
//
// UNTRUSTED BYTES. A `.docx` is a zip of XML an attacker controls end to end, so opening one
// goes through `readOoxmlPackage` — decompression-ratio and size caps, part/rel path
// validation, DTD/entity-free XML — and a refusal is a typed reason rather than a throw. This
// host performs no external fetch of any kind, and it has no HTML, DOM or CSS sink to feed:
// the only thing that leaves it is DOCX bytes from the normalizing serializer, and plain text
// and opaque handles through the protocol.
//
// PARAGRAPH IDENTITY is normalized at open, the same way the browser session normalizes it,
// so a document Word never gave `w14:paraId`s gets them once and both hosts hold the same
// canonical tree from revision zero. Skipping it here would make the two hosts' fingerprints
// differ on the first save of such a document, for no reason a consumer could see.

import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPackageLimits,
  type OoxmlPackageRejection,
} from '../store/package/ooxml-package.ts';
import { ensureHyperlinkRelationship } from '../store/package/hyperlink-part.ts';
import { normalizeParagraphIdentity } from '../store/package/para-id.ts';
import { TreePackageStore, type StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { addComment, setCommentResolved } from '../store/store/comment-writes.ts';
import { deleteCommentReply, deleteCommentThread } from '../store/package/comment-lifecycle.ts';
import { insertCustomNodeWrite } from '../store/store/custom-node-writes.ts';
import type {
  AutomationCommentWriteResult,
  AutomationDocumentPort,
  AutomationPortApplyResult,
  AutomationStagedOps,
} from './document-port.ts';
import { createAutomationHost } from './host.ts';
import type { AutomationCapabilities, AutomationHost } from './protocol.ts';

/** What a headless host can do. It paints nothing, so it claims nothing about painting. */
export const SERVER_AUTOMATION_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: true,
  events: true,
  selection: false,
  scrolling: false,
  layout: false,
});

/**
 * Why bytes could not be opened as a document: any bounded-reader rejection, plus the package
 * that parsed but carried no main document part.
 */
export type ServerAutomationHostRejection = OoxmlPackageRejection | 'no-main-document-part';

/**
 * A host over the opened bytes, or a refusal.
 *
 * A result rather than a throw: these bytes are untrusted input, and a malformed upload should
 * be a value the caller inspects rather than an exception from inside a zip decoder.
 */
export type ServerAutomationHostResult =
  | { readonly ok: true; readonly host: AutomationHost }
  | {
      readonly ok: false;
      readonly reason: ServerAutomationHostRejection;
      readonly detail?: string;
    };

/**
 * How a headless host opens a document. Every field is optional.
 *
 * @public
 */
export interface ServerAutomationHostOptions {
  /**
   * Tighter budgets for the bounded reader — zip ratio, part count, XML depth.
   *
   * Exposed because a server opening documents it did not author is exactly where a caller
   * may want smaller limits than the defaults. Omitted means the engine's own defaults.
   */
  readonly limits?: OoxmlPackageLimits;
}

const BODY: StoryScope = Object.freeze({ kind: 'body' as const });

/**
 * Open DOCX bytes into a headless automation host.
 *
 * A typed rejection rather than a throw: every failure here is a property of the FILE, and a
 * caller needs to tell "not a package" from "this package is hostile" from "no body".
 */
export function createServerAutomationHost(
  bytes: Uint8Array,
  options: ServerAutomationHostOptions = {}
): ServerAutomationHostResult {
  const loaded = readOoxmlPackage(bytes, options.limits ?? {});
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) {
    return {
      ok: false,
      reason: 'no-main-document-part',
      detail: loaded.package.mainDocumentPart,
    };
  }
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return {
    ok: true,
    host: createAutomationHost({
      port: packageStorePort(store),
      capabilities: SERVER_AUTOMATION_CAPABILITIES,
    }),
  };
}

/**
 * The relationship id for an external hyperlink target on the addressed story's part, or null.
 *
 * The shell, not a story transaction: the relationship lives beside the trees, and the store keeps it
 * across lifecycle snapshots so an undo cannot orphan the `r:id` a committed link names. An
 * unreferenced hyperlink relationship is inert markup Word writes too, so this order — relationship
 * first, then the op that names it — is the engine's own; the reverse would publish a link pointing
 * at an id nothing declares.
 */
function mintExternalTarget(
  store: TreePackageStore,
  url: string,
  scope: StoryScope
): string | null {
  const owner = store.partFor(scope);
  if (!owner) return null;
  const minted = ensureHyperlinkRelationship(store.currentPackage(), url, owner.name);
  if (!minted) return null;
  store.replacePackageShell(minted.pkg);
  return minted.relationshipId;
}

/**
 * The port over a store this host owns.
 *
 * `apply` is one `transact` call for the whole batch — that is where atomicity comes from,
 * not from anything the host layer does: the store stages ops against a working package and
 * publishes nothing until every one of them has been accepted.
 */
function packageStorePort(store: TreePackageStore): AutomationDocumentPort {
  let live = true;
  return {
    revision: () => store.packageRevision,
    currentPackage: (): OoxmlPackage | null => (live ? store.currentPackage() : null),
    apply(staged: AutomationStagedOps, scope: StoryScope = BODY): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      // BUILT HERE, not by the planner: minting the relationship an external link names changes the
      // package, and this host has no mode to refuse a write, so "here" is as late as it gets — a
      // batch that was refused while planning has already left without touching anything.
      const ops = staged((url) => mintExternalTarget(store, url, scope));
      if (ops === null) return { ok: false, reason: 'unsupported-target' };
      const result = store.transact(scope, (ctx) => {
        for (const op of ops) ctx.apply(op);
      });
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      return { ok: true, changed: result.change !== null };
    },
    applyLifecycle(op: TreeDocOp): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      // The store's own package transaction: parts, relationships, content types and settings
      // restored together on undo. Routed here rather than through `transact` because a story
      // transaction cannot carry a part it does not own.
      const result = store.applyLifecycleOp(op);
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      return { ok: true, changed: result.change !== null };
    },
    applyCommentWrites(writes, scope): AutomationCommentWriteResult {
      if (!live) return { ok: false, reason: 'disposed' };
      if (writes.length === 0) return { ok: true, changed: false };
      const story = store.resolveStory(scope);
      if (!story.ok) return { ok: false, reason: story.reason };
      // The story store keeps a package of its own, and the coordinator's copy carries writes the
      // story store has not seen — a minted hyperlink relationship, a numbering graft. Grafting
      // before and republishing after is the same order the editor's own comment path uses; skip
      // either half and one write silently overwrites the other's parts.
      story.store.graftPackage(() => store.currentPackage());
      if (writes.every((write) => write.kind === 'delete')) {
        let refused = false;
        let changed = false;
        const transaction = story.store.transact((ctx) => {
          ctx.applyPackage((current) => {
            let next = current;
            for (const write of writes) {
              if (write.kind !== 'delete') continue;
              const deleted =
                write.parentCommentId === undefined
                  ? deleteCommentThread(next, write.commentId)
                  : deleteCommentReply(next, write.commentId, write.parentCommentId);
              if (deleted === null) {
                refused = true;
                return current;
              }
              changed ||= deleted !== next;
              next = deleted;
            }
            return next;
          });
        });
        if (refused || !transaction.ok) return { ok: false, reason: 'comment-delete-refused' };
        if (changed) store.installPackageSnapshot(story.store.package);
        return { ok: true, changed };
      }
      if (writes.length !== 1) return { ok: false, reason: 'mixed-comment-writes' };
      const write = writes[0]!;
      const result =
        write.kind === 'create'
          ? addComment(story.store, {
              anchor: write.anchor,
              author: write.author,
              text: write.text,
              ...(write.date === undefined ? {} : { date: write.date }),
            })
          : write.kind === 'reply'
            ? addComment(story.store, {
                anchor: write.anchor,
                author: write.author,
                text: write.text,
                ...(write.date === undefined ? {} : { date: write.date }),
                replyToCommentId: write.parentCommentId,
              })
            : write.kind === 'resolve'
              ? setCommentResolved(story.store, write.commentId, write.resolved)
              : null;
      if (result === null) return { ok: false, reason: 'unsupported-comment-write' };
      if (!result.ok) return { ok: false, reason: result.reason };
      store.replacePackageShell(story.store.package);
      return {
        ok: true,
        changed: true,
        ...('commentId' in result ? { commentId: result.commentId } : {}),
      };
    },
    applyCustomNodeWrite(write, scope): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      const story = store.resolveStory(scope);
      if (!story.ok) return { ok: false, reason: story.reason };
      // Grafted before and republished after, exactly as the comment path is: the story store's
      // package is not the coordinator's, and skipping either half lets one write silently
      // overwrite the parts the other made.
      story.store.graftPackage(() => store.currentPackage());
      const result = insertCustomNodeWrite(story.store, write);
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      store.replacePackageShell(story.store.package);
      return { ok: true, changed: result.change !== null };
    },
    save: () => (live ? writeOoxmlPackage(store.currentPackage()) : null),
    subscribe: (listener) => store.subscribe(() => listener()),
    dispose() {
      live = false;
    },
  };
}
