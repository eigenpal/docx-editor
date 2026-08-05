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
import type {
  AutomationCommentWriteResult,
  AutomationDocumentPort,
  AutomationPortApplyResult,
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

export type ServerAutomationHostRejection = OoxmlPackageRejection | 'no-main-document-part';

export type ServerAutomationHostResult =
  | { readonly ok: true; readonly host: AutomationHost }
  | {
      readonly ok: false;
      readonly reason: ServerAutomationHostRejection;
      readonly detail?: string;
    };

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
    apply(ops: readonly TreeDocOp[], scope: StoryScope = BODY): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
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
    ensureExternalTarget(url: string, scope: StoryScope): string | null {
      if (!live) return null;
      const owner = store.partFor(scope);
      if (!owner) return null;
      const minted = ensureHyperlinkRelationship(store.currentPackage(), url, owner.name);
      if (!minted) return null;
      // The shell, not a story transaction: the relationship lives beside the trees, and the
      // store keeps it across lifecycle snapshots so an undo cannot orphan the `r:id` a
      // committed link names.
      store.replacePackageShell(minted.pkg);
      return minted.relationshipId;
    },
    applyCommentWrite(write, scope): AutomationCommentWriteResult {
      if (!live) return { ok: false, reason: 'disposed' };
      const story = store.resolveStory(scope);
      if (!story.ok) return { ok: false, reason: story.reason };
      // The story store keeps a package of its own, and the coordinator's copy carries writes the
      // story store has not seen — a minted hyperlink relationship, a numbering graft. Grafting
      // before and republishing after is the same order the editor's own comment path uses; skip
      // either half and one write silently overwrites the other's parts.
      story.store.graftPackage(() => store.currentPackage());
      const result =
        write.kind === 'reply'
          ? addComment(story.store, {
              anchor: write.anchor,
              author: write.author,
              text: write.text,
              ...(write.date === undefined ? {} : { date: write.date }),
              replyToCommentId: write.parentCommentId,
            })
          : setCommentResolved(story.store, write.commentId, write.resolved);
      if (!result.ok) return { ok: false, reason: result.reason };
      store.replacePackageShell(story.store.package);
      return {
        ok: true,
        changed: true,
        ...('commentId' in result ? { commentId: result.commentId } : {}),
      };
    },
    save: () => (live ? writeOoxmlPackage(store.currentPackage()) : null),
    subscribe: (listener) => store.subscribe(() => listener()),
    dispose() {
      live = false;
    },
  };
}
