// Replay a saved case and print one paragraph's shared text on every replica: each Yjs item
// with its ID, origin and content, then the identities, hidden positions, following text and
// follow anchors each replica reads from it. Two replicas that hold the same items but read
// different identities point at a reading that depends on what a replica collected.
//
//   bun inspect-paragraph.ts <case.json> [<config>] <paragraph-id> [flags]
//
// The case runs on the document of its own scenario shape unless <config> names another.
// Flags add views:
//
//   --unsettled            inspect after the last action, before the final delivery
//   --paragraphs           print the first paragraphs each replica's editor shows
//   --ids                  print the paragraphs with their IDs
//   --all                  print every paragraph, not only the first ones
//   --find <text>          name every paragraph whose shared text contains <text>
//   --find-replica <n>     search replica n's shared text instead of replica 0's
//   --holders <a,b>        print the paragraphs that hold these identities
//   --deletions            print every replica's deletion records
//   --shows <text>         name the paragraphs whose shown text contains <text>, on every replica
//   --stale                whether each editor shows what a fresh build of its shared state shows
//   --children             the children each editor shows for the paragraph, with their text
//   --listed <p,c>         whether parent p lists child c on every replica, with its listing items

// First: the scenario clock has to replace Date.now before Yjs loads.
import './scenario-clock.ts';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import * as Y from 'yjs';
import { replayActions, type InspectedReplica } from './scenario-harness.ts';
import { readCase, replayOf } from './scenario-case.ts';
import { configFor, DEFAULT_DOCUMENT, documentFor } from './scenarios.ts';
import { textIdentities } from '../../packages/pro/src/collaboration/document/paragraph-text-identity.ts';
import { INLINE_FIELD } from '../../packages/pro/src/collaboration/document/paragraph-text.ts';
import type { LogicalId } from '../../packages/pro/src/collaboration/document/index.ts';
import { fingerprint, firstDifference } from './scenario-oracles.ts';
import { TEXT_DELETIONS_KEY } from '../../packages/pro/src/collaboration/document/paragraph-text-deletions.ts';
import {
  awaitingUpdates,
  firstItem,
} from '../../packages/pro/src/collaboration/document/yjs-items.ts';
import { followInternals, freshBuild, freshRegistry, sessionInternals } from './scenario-fresh.ts';
import { findNode, paragraphs, sharedNodes, sharedTexts, textOf } from './scenario-tree.ts';

/** Line breaks show as this mark in printed text. */
const BREAK = '⏎';

/** Client IDs are long; their last three digits tell replicas apart in a printout. */
const short = (client: number): number => client % 1000;

function describe(item: Y.Item): string {
  const content = item.content;
  const body =
    content instanceof Y.ContentString
      ? JSON.stringify(content.str)
      : content instanceof Y.ContentFormat
        ? `${content.key}=${String(content.value).slice(0, 40)}`
        : content instanceof Y.ContentEmbed
          ? JSON.stringify(content.embed)
          : content.constructor.name;
  const origin = item.origin ? `<${short(item.origin.client)}:${item.origin.clock}` : '<-';
  const mark = item.deleted ? '~' : '';
  return `${mark}${short(item.id.client)}:${item.id.clock}+${item.length} ${origin} ${body}`;
}

/** The first paragraphs each replica's editor shows, or all of them, with or without IDs. */
function printParagraphs(
  replicas: readonly InspectedReplica[],
  withIds: boolean,
  all: boolean
): void {
  for (const replica of replicas) {
    const texts = paragraphs(replica.store.bodyStore().part.root).map((node) => {
      const text = textOf(node, BREAK).slice(0, 90);
      return withIds ? `${node.id}=${text}` : text;
    });
    console.log('paragraphs', replica.index, JSON.stringify(all ? texts : texts.slice(0, 6)));
  }
}

/** The paragraphs whose shown text contains `wanted`, and every copy of it in shared state. */
function printShows(replicas: readonly InspectedReplica[], wanted: string): void {
  for (const replica of replicas) {
    const showing = paragraphs(replica.store.bodyStore().part.root)
      .filter((node) => textOf(node, BREAK).includes(wanted))
      .map((node) => node.id);
    const waiting = awaitingUpdates(replica.ydoc) ? ' (awaiting held-back updates)' : '';
    // Every copy of the text in shared state, with the identity each copy reads.
    const held: string[] = [];
    for (const [key, text] of sharedTexts(replica.ydoc)) {
      let position = 0;
      let ids: readonly (string | null)[] | null = null;
      for (const op of text.toDelta() as { insert: unknown }[]) {
        if (typeof op.insert !== 'string') {
          position += 1;
          continue;
        }
        const at = op.insert.indexOf(wanted);
        if (at >= 0) {
          ids ??= textIdentities(text).ids;
          held.push(`${key}@${ids[position + at]}`);
        }
        position += op.insert.length;
      }
    }
    console.log(
      'shows',
      replica.index,
      JSON.stringify(showing) + waiting,
      'held',
      JSON.stringify(held)
    );
  }
}

/** The children each editor shows for the paragraph, with their text. */
function printChildren(replicas: readonly InspectedReplica[], paragraph: string): void {
  for (const replica of replicas) {
    const node = findNode(replica.store.bodyStore().part.root, paragraph);
    if (!node || node.kind === 'textValue') continue;
    const children = node.children.map(
      (child) => `${child.id}=${JSON.stringify(textOf(child, BREAK))}`
    );
    console.log('children', replica.index, children.join(' '));
  }
}

/** Whether each editor shows what a fresh build of its shared state shows, waiting or not. */
function printStale(replicas: readonly InspectedReplica[]): void {
  for (const replica of replicas) {
    const built = freshBuild(replica.ydoc, replica.session);
    const local = fingerprint(replica.store.currentPackage());
    const verdict = !built.ok
      ? `no fresh build (${built.code})`
      : fingerprint(built.package) === local
        ? 'current'
        : `stale ${firstDifference(fingerprint(built.package), local)}`;
    const waiting = awaitingUpdates(replica.ydoc) ? 'awaiting' : 'complete';
    const { viewWaiting } = sessionInternals(replica.session);
    console.log(
      'stale',
      replica.index,
      waiting,
      `viewWaiting=${viewWaiting}`,
      verdict.slice(0, 400)
    );
  }
}

/** Whether each replica's shared parent lists the child, and the listing items for it. */
function printListed(replicas: readonly InspectedReplica[], listed: string): void {
  const [parentId, childId] = listed.split(',');
  for (const replica of replicas) {
    const parent = sharedNodes(replica.ydoc).get(parentId!);
    const children = parent instanceof Y.Map ? parent.get('children') : null;
    if (!(children instanceof Y.Array)) continue;
    const items: string[] = [];
    for (let item = children._start; item; item = item.right) {
      const content = item.content.getContent() as unknown[];
      if (content.includes(childId)) items.push(describe(item));
    }
    console.log('listed', replica.index, children.toArray().includes(childId), items);
  }
}

/** Every replica's deletion records. */
function printDeletions(replicas: readonly InspectedReplica[]): void {
  for (const replica of replicas) {
    const records = [...replica.ydoc.getMap<string>(TEXT_DELETIONS_KEY).entries()];
    console.log('deletions', replica.index, JSON.stringify(records));
  }
}

/** Every paragraph whose shared text on one replica contains `wanted`. */
function printFound(replicas: readonly InspectedReplica[], wanted: string, on: number): void {
  const finder = replicas[on] ?? replicas[0]!;
  for (const [key, text] of sharedTexts(finder.ydoc)) {
    if (text.toString().includes(wanted)) {
      console.log('found', key, JSON.stringify(text.toString()));
    }
  }
}

/**
 * The paragraph's shared text on every replica, and what the replica's registry reads from it,
 * next to what a registry built from shared state alone reads.
 */
function printParagraph(
  replicas: readonly InspectedReplica[],
  paragraph: string,
  holdersAsked: readonly string[] | null
): void {
  const id = paragraph as LogicalId;
  for (const replica of replicas) {
    const record = sharedNodes(replica.ydoc).get(paragraph);
    if (!(record instanceof Y.Map)) continue;
    const text = record.get(INLINE_FIELD);
    if (!(text instanceof Y.Text)) continue;
    const items: string[] = [];
    for (let item = firstItem(text); item; item = item.right) {
      items.push(describe(item));
    }
    const { registry, follow } = sessionInternals(replica.session);
    const shown = registry.inline.viewOf(id).shown(text);
    const identities = textIdentities(text);
    const children = record.get('children');
    console.log(
      `== replica ${replica.index} deleted=${String(record.get('deleted'))} children=${JSON.stringify(children instanceof Y.Array ? children.toArray() : [])}`
    );
    for (const line of items) console.log(`    ${line}`);
    console.log('   identities', JSON.stringify(identities.ids));
    console.log(
      '   hidden',
      JSON.stringify([...shown.hidden]),
      'incoming',
      JSON.stringify(shown.incoming)
    );
    console.log('   anchors', JSON.stringify(identities.anchors));
    console.log('   copiedAfter', JSON.stringify(identities.copiedAfter));
    console.log(
      '   deleted',
      JSON.stringify(identities.deleted.flatMap((d, at) => (d ? [at] : [])))
    );
    const targets = identities.anchors
      .flatMap((anchors) => anchors ?? [])
      .map((anchor) => `${anchor.identity} -> ${follow.shownCopy(anchor.identity)}`);
    console.log('   anchor targets', JSON.stringify(targets));
    console.log(
      '   source',
      follow.sources.has(id),
      'outgoing',
      JSON.stringify(follow.outgoingOf.get(id)?.positions ?? []),
      'cached anchors',
      follow.identities.get(id)?.identities.hasAnchors
    );
    // The same questions against a registry built from shared state alone.
    const fresh = freshRegistry(replica.ydoc, replica.session);
    const freshFollow = followInternals(fresh);
    const freshShown = fresh.inline.viewOf(id).shown(text);
    const freshTargets = identities.anchors
      .flatMap((anchors) => anchors ?? [])
      .map((anchor) => `${anchor.identity} -> ${freshFollow.shownCopy(anchor.identity)}`);
    console.log(
      '   fresh hidden',
      JSON.stringify([...freshShown.hidden]),
      'targets',
      JSON.stringify(freshTargets)
    );
    for (const identity of holdersAsked ?? identities.ids.slice(0, 3)) {
      if (!identity) continue;
      console.log(
        '   holders',
        identity,
        JSON.stringify(follow.holdersOf(identity)),
        'fresh',
        JSON.stringify(freshFollow.holdersOf(identity))
      );
      for (const holder of follow.holdersOf(identity)) {
        console.log(
          '     ',
          holder,
          'live deleted',
          registry.inline.isDeletedParagraph(holder),
          'parent',
          registry.parentOf(holder),
          'fresh deleted',
          fresh.inline.isDeletedParagraph(holder),
          'parent',
          fresh.parentOf(holder),
          'tomb',
          fresh.isTombstoned(holder)
        );
      }
    }
    fresh.destroy();
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    unsettled: { type: 'boolean', default: false },
    paragraphs: { type: 'boolean', default: false },
    ids: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    find: { type: 'string' },
    'find-replica': { type: 'string' },
    holders: { type: 'string' },
    deletions: { type: 'boolean', default: false },
    shows: { type: 'string' },
    stale: { type: 'boolean', default: false },
    children: { type: 'boolean', default: false },
    listed: { type: 'string' },
  },
});
// The config is optional: a saved case names its own.
const [file, config, paragraph] =
  positionals.length === 2 ? [positionals[0], undefined, positionals[1]] : positionals;
if (!file || !paragraph || positionals.length > 3) {
  throw new Error('usage: bun inspect-paragraph.ts <case.json> [<config>] <paragraph-id> [flags]');
}
const saved = readCase(file);
const document = documentFor(
  configFor(config, saved),
  new Uint8Array(readFileSync(DEFAULT_DOCUMENT))
);
await replayActions(document, {
  ...replayOf(saved),
  // Without settling, each replica shows what it held after the last action.
  settle: !values.unsettled,
  inspect: (replicas) => {
    if (values.paragraphs || values.ids || values.all) {
      printParagraphs(replicas, values.ids, values.all);
    }
    if (values.shows) printShows(replicas, values.shows);
    if (values.children) printChildren(replicas, paragraph);
    if (values.stale) printStale(replicas);
    if (values.listed) printListed(replicas, values.listed);
    if (values.deletions) printDeletions(replicas);
    if (values.find) printFound(replicas, values.find, Number(values['find-replica'] ?? 0));
    printParagraph(replicas, paragraph, values.holders ? values.holders.split(',') : null);
  },
});
process.exit(0);
